// The content script's logic, with its environment passed in so it can be tested.
//
// Orphans: when the extension is reloaded, updated or removed while a tab stays open, this instance's extension
// context dies but its DOM listeners, timers and stage keep running (and a newer instance does not always land in the
// same isolated world to dispose it, see guard.ts). So every entry point that can act later (DOM events, timers, stage
// events, mounting, the title observer) first asks `live()`: if the instance's own liveness probe says the context is
// dead, the whole instance is disposed using the DOM only, and nothing else happens. An orphan never calls an extension
// API, so it never puts an error on the console.
import { markTab, unmarkTab } from './mark';
import { watchTyping } from './typed';
import type { Stage } from '../stage/mount';
import type { SpriteMeta } from '../stage/render';
import type { ToBackground, ToContent, VisitEvent } from '../shared/types';

/** What the background serves for `pockets/sprites`: the sprite metadata, three sheets and the notice icon, the
 *  images as data URLs. */
export interface StageAssets { meta: SpriteMeta; sheets: string[]; icon: string }

export interface HostEnv {
  win: Window;
  doc: Document;
  sendMessage: (msg: ToBackground) => Promise<unknown>;
  onMessage: (fn: (msg: unknown, respond: (r: unknown) => void) => boolean | void) => void;
  /** Decodes the assets and mounts the stage. Rejects if they cannot be decoded. */
  mountStage: (doc: Document, assets: StageAssets) => Promise<Stage>;
  /** This instance's own liveness probe (guard.ts contextProbe over the chrome.runtime it started with). False, or
   *  throwing, means the extension context is dead: the instance disposes itself. Defaults to always alive. */
  alive?: () => boolean;
  /**
   * The top frame's typing state for this document is unknown: this instance did not see the document start (it was
   * injected into a tab open since before install or update, or the document_start script's page-loaded is missing).
   * The tab is then reported as typed in at once, so it is protected until it next loads a page.
   */
  typingUnknown?: boolean;
  /** Delay between attempts of a report that must not be lost. Tests shorten it. */
  retryMs?: number;
  /** While the tab is marked, how often an otherwise idle instance checks that it is still alive. Tests shorten it. */
  watchMs?: number;
}

export interface ContentHandle {
  /** Stops everything this instance does in the page: called when a newer instance replaces an orphaned one, or by
   *  the instance itself once its extension context is dead. */
  dispose(): void;
}

const REPORT_ATTEMPTS = 5;

/** A usable `pockets/sprites` reply, or null. */
export function assetsFrom(r: unknown): StageAssets | null {
  if (!r || typeof r !== 'object') return null;
  const o = r as { ok?: unknown; meta?: unknown; sheets?: unknown; icon?: unknown };
  if (o.ok !== true || !o.meta || typeof o.meta !== 'object' || typeof o.icon !== 'string' || !o.icon.startsWith('data:image/')) return null;
  if (!Array.isArray(o.sheets) || o.sheets.length !== 3 || !o.sheets.every((s) => typeof s === 'string' && s.startsWith('data:image/'))) return null;
  return { meta: o.meta as SpriteMeta, sheets: o.sheets as string[], icon: o.icon };
}

export function startContent(env: HostEnv): ContentHandle {
  const { win, doc } = env;
  const probe = env.alive ?? (() => true);
  let disposed = false;
  const cleanups: (() => void)[] = [];

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    for (const c of cleanups.splice(0)) {
      try { c(); } catch { /* ignore */ }
    }
  };
  const handle: ContentHandle = { dispose };

  /** The gate in front of every entry point: false once disposed; if the extension context has died, disposes the
   *  whole instance first. */
  const live = (): boolean => {
    if (disposed) return false;
    let ok = false;
    try { ok = probe() === true; } catch { ok = false; }
    if (!ok) dispose();
    return ok;
  };

  const request = (msg: ToBackground): Promise<unknown> => {
    if (!live()) return Promise.reject(new Error('Pockets: no extension context'));
    try {
      return Promise.resolve(env.sendMessage(msg));
    } catch (e) {
      return Promise.reject(e);
    }
  };
  const send = (msg: ToBackground): Promise<boolean> => request(msg).then(() => true, () => false);

  /** A typing report with no later input event to retry it: try a few times. */
  let retryTimer: number | undefined;
  cleanups.push(() => {
    if (retryTimer !== undefined) win.clearTimeout?.(retryTimer);
    retryTimer = undefined;
  });
  const reportTyped = (attempt = 1): void => {
    void send({ type: 'pockets/typed' }).then((ok) => {
      if (!ok && !disposed && attempt < REPORT_ATTEMPTS) {
        retryTimer = win.setTimeout(() => {
          retryTimer = undefined;
          if (live()) reportTyped(attempt + 1);
        }, env.retryMs ?? 500);
      }
    });
  };

  // Typing seen in this document, set on the input event itself (not on a successful send).
  let typedSeen = false;
  cleanups.push(watchTyping(doc, () => {
    if (!live()) return false;
    typedSeen = true;
    return send({ type: 'pockets/typed' });
  }));

  // Back/forward cache: a restored page does not re-run any content script, while the page the user left cleared the
  // tab's typed-in protection with its own page-loaded. Report again if this document was typed into. Every frame does
  // this for its own typing.
  const onPageShow = (e: Event) => {
    if (!live()) return;
    if ((e as PageTransitionEvent).persisted === true && typedSeen) reportTyped();
  };
  win.addEventListener('pageshow', onPageShow);
  cleanups.push(() => win.removeEventListener('pageshow', onPageShow));

  // Child frames only report typing; the top frame alone answers the background.
  // page-loaded is not sent from here: content-start.js sends it at document_start (see start.ts).
  if (win !== win.top) return handle;

  // Stage hosts left in the page by an orphaned instance (an older build whose context died) would sit over ours.
  for (const el of Array.from(doc.querySelectorAll('pockets-stage'))) el.remove();

  // Unknown typing counts as typing seen in this document, so a back/forward-cache restore (which is not a new page
  // load) re-reports it like real typing.
  if (env.typingUnknown) {
    typedSeen = true;
    reportTyped();
  }

  let stagePromise: Promise<Stage> | null = null;
  let stage: Stage | null = null;
  let currentVisit: string | null = null;

  /** The page may have removed the stage element; a cached stage is then dead and is dropped, so the next use mounts
   *  a fresh one. */
  const dropDeadStage = (): void => {
    if (stage && !stage.connected()) {
      const dead = stage;
      stage = null;
      stagePromise = null;
      try { dead.destroy(); } catch { /* ignore */ }
    }
  };

  // The tab mark. An idle instance gets no events while its tab shows "Mine in N…", so while marked it checks its
  // liveness now and then: an orphan puts the page's own title and icon back instead of leaving the countdown up.
  let marked = false;
  let watchTimer: number | undefined;
  const stopWatch = (): void => {
    if (watchTimer !== undefined) win.clearTimeout?.(watchTimer);
    watchTimer = undefined;
  };
  const watch = (): void => {
    if (watchTimer !== undefined) return;
    watchTimer = win.setTimeout(() => {
      watchTimer = undefined;
      if (live() && marked) watch();
    }, env.watchMs ?? 5000);
  };
  const unmark = (): void => {
    marked = false;
    stopWatch();
    unmarkTab(doc);
  };

  // Leaving for the back/forward cache: the background ends any visit on this tab when its URL changes, so stop the
  // animation here too; a restored page must not carry on with an old visit. On return, drop a stage that is gone.
  const onPageHide = (e: Event) => {
    if (!live()) return;
    if ((e as PageTransitionEvent).persisted !== true) return;
    currentVisit = null;
    try { stage?.cancel(); } catch { /* ignore */ }
  };
  const onTopPageShow = (e: Event) => {
    if (!live()) return;
    if ((e as PageTransitionEvent).persisted === true) dropDeadStage();
  };
  win.addEventListener('pagehide', onPageHide);
  win.addEventListener('pageshow', onTopPageShow);
  cleanups.push(() => {
    win.removeEventListener('pagehide', onPageHide);
    win.removeEventListener('pageshow', onTopPageShow);
    currentVisit = null;
    const s = stage;
    stage = null;
    stagePromise = null;
    try { s?.destroy(); } catch { /* ignore */ }
    // DOM only: puts back the page's title and icon (or the title the page set meanwhile).
    if (marked) {
      try { unmark(); } catch { /* ignore */ }
    }
    stopWatch();
  });

  const notMine = () => new Error('Pockets: this instance is gone');
  const getStage = (): Promise<Stage> => {
    if (!live()) return Promise.reject(notMine());
    dropDeadStage();
    if (!stagePromise) {
      const p = request({ type: 'pockets/sprites' })
        .then((reply) => {
          if (!live()) throw notMine();
          const assets = assetsFrom(reply);
          if (!assets) throw new Error('Pockets: no sprites');
          return env.mountStage(doc, assets);
        })
        .then((s) => {
          // Disposed (or orphaned) while mounting: this stage belongs to no one.
          if (!live()) {
            try { s.destroy(); } catch { /* ignore */ }
            throw notMine();
          }
          return (stage = s);
        });
      p.catch(() => { if (stagePromise === p) stagePromise = null; });
      stagePromise = p;
    }
    return stagePromise;
  };

  env.onMessage((raw, respond) => {
    if (!live()) return false;
    try {
      const msg = raw as ToContent;
      switch (msg.type) {
        case 'pockets/ping':
          respond({ type: 'pockets/pong', from: 'content' });
          return false;
        case 'pockets/play': {
          const { plan } = msg;
          currentVisit = plan.visitId;
          getStage().then(
            (s) => {
              if (currentVisit === plan.visitId) {
                s.play(plan, (event: VisitEvent) => { void send({ type: 'pockets/event', visitId: plan.visitId, event }); }).catch(() => {});
              }
              respond({ ok: true });
            },
            () => respond({ ok: false }),
          ).catch(() => {});
          return true;
        }
        case 'pockets/cancel':
          if (msg.visitId === currentVisit) {
            currentVisit = null;
            stage?.cancel();
          }
          respond({ ok: true });
          return false;
        case 'pockets/mark': {
          const icon = typeof msg.icon === 'string' && msg.icon.startsWith('data:image/') ? msg.icon : null;
          markTab(doc, msg.remaining, icon, live);
          marked = true;
          watch();
          respond({ ok: true });
          return false;
        }
        case 'pockets/unmark':
          unmark();
          respond({ ok: true });
          return false;
        case 'pockets/notice': {
          const takenAt = msg.takenAt;
          getStage().then(
            (s) => {
              s.showNotice(msg.title, (event: VisitEvent) => { if (event.type === 'undo') void send({ type: 'pockets/undo', takenAt }); });
              respond({ ok: true });
            },
            () => respond({ ok: false }),
          ).catch(() => {});
          return true;
        }
        default:
          return false;
      }
    } catch {
      try { respond({ ok: false }); } catch { /* ignore */ }
      return false;
    }
  });
  return handle;
}
