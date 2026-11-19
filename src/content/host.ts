// The content script's logic, with its environment passed in so it can be tested.
import { markTab, unmarkTab } from './mark';
import { watchTyping } from './typed';
import type { Stage } from '../stage/mount';
import type { ToBackground, ToContent, VisitEvent } from '../shared/types';

export interface HostEnv {
  win: Window;
  doc: Document;
  assetBase: string;
  iconUrl: string;
  sendMessage: (msg: ToBackground) => Promise<unknown>;
  onMessage: (fn: (msg: unknown, respond: (r: unknown) => void) => boolean | void) => void;
  mountStage: (doc: Document, assetBase: string) => Promise<Stage>;
  /**
   * The top frame's typing state for this document is unknown: this instance did not see the document start (it was
   * injected into a tab open since before install or update, or the document_start script's page-loaded is missing).
   * The tab is then reported as typed in at once, so it is protected until it next loads a page.
   */
  typingUnknown?: boolean;
  /** Delay between attempts of a report that must not be lost. Tests shorten it. */
  retryMs?: number;
}

export interface ContentHandle {
  /** Stops everything this instance does in the page: called when a newer instance replaces an orphaned one. */
  dispose(): void;
}

const REPORT_ATTEMPTS = 5;

export function startContent(env: HostEnv): ContentHandle {
  const { win, doc } = env;
  let disposed = false;
  const cleanups: (() => void)[] = [];
  const send = (msg: ToBackground): Promise<boolean> => {
    if (disposed) return Promise.resolve(false);
    try {
      return Promise.resolve(env.sendMessage(msg)).then(() => true, () => false);
    } catch {
      return Promise.resolve(false);
    }
  };
  /** A typing report with no later input event to retry it: try a few times. */
  const reportTyped = (attempt = 1): void => {
    void send({ type: 'pockets/typed' }).then((ok) => {
      if (!ok && !disposed && attempt < REPORT_ATTEMPTS) win.setTimeout(() => reportTyped(attempt + 1), env.retryMs ?? 500);
    });
  };

  // Typing seen in this document, set on the input event itself (not on a successful send).
  let typedSeen = false;
  cleanups.push(watchTyping(doc, () => {
    typedSeen = true;
    return send({ type: 'pockets/typed' });
  }));

  // Back/forward cache: a restored page does not re-run any content script, while the page the user left cleared the
  // tab's typed-in protection with its own page-loaded. Report again if this document was typed into. Every frame does
  // this for its own typing.
  const onPageShow = (e: Event) => {
    if ((e as PageTransitionEvent).persisted === true && typedSeen) reportTyped();
  };
  win.addEventListener('pageshow', onPageShow);
  cleanups.push(() => win.removeEventListener('pageshow', onPageShow));

  const handle: ContentHandle = {
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const c of cleanups.splice(0)) {
        try { c(); } catch { /* ignore */ }
      }
    },
  };

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

  // Leaving for the back/forward cache: the background ends any visit on this tab when its URL changes, so stop the
  // animation here too; a restored page must not carry on with an old visit. On return, drop a stage that is gone.
  const onPageHide = (e: Event) => {
    if ((e as PageTransitionEvent).persisted !== true) return;
    currentVisit = null;
    try { stage?.cancel(); } catch { /* ignore */ }
  };
  const onTopPageShow = (e: Event) => {
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
  });

  const getStage = (): Promise<Stage> => {
    dropDeadStage();
    if (!stagePromise) {
      const p = env.mountStage(doc, env.assetBase).then((s) => {
        // Disposed while mounting: this stage belongs to no one.
        if (disposed) {
          try { s.destroy(); } catch { /* ignore */ }
          throw new Error('disposed');
        }
        return (stage = s);
      });
      p.catch(() => { if (stagePromise === p) stagePromise = null; });
      stagePromise = p;
    }
    return stagePromise;
  };

  env.onMessage((raw, respond) => {
    if (disposed) return false;
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
          );
          return true;
        }
        case 'pockets/cancel':
          if (msg.visitId === currentVisit) {
            currentVisit = null;
            stage?.cancel();
          }
          respond({ ok: true });
          return false;
        case 'pockets/mark':
          markTab(doc, msg.remaining, env.iconUrl);
          respond({ ok: true });
          return false;
        case 'pockets/unmark':
          unmarkTab(doc);
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
          );
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
