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
}

export function startContent(env: HostEnv): void {
  const { win, doc } = env;
  const send = (msg: ToBackground): Promise<boolean> => {
    try {
      return Promise.resolve(env.sendMessage(msg)).then(() => true, () => false);
    } catch {
      return Promise.resolve(false);
    }
  };

  watchTyping(doc, () => send({ type: 'pockets/typed' }));

  // Child frames only report typing; the top frame alone answers the background.
  if (win !== win.top) return;

  let stagePromise: Promise<Stage> | null = null;
  let stage: Stage | null = null;
  let currentVisit: string | null = null;

  const getStage = (): Promise<Stage> => {
    // The page may have removed the stage element; a cached stage is then dead, so mount a fresh one.
    if (stage && !stage.connected()) {
      const dead = stage;
      stage = null;
      stagePromise = null;
      try { dead.destroy(); } catch { /* ignore */ }
    }
    if (!stagePromise) {
      const p = env.mountStage(doc, env.assetBase).then((s) => (stage = s));
      p.catch(() => { if (stagePromise === p) stagePromise = null; });
      stagePromise = p;
    }
    return stagePromise;
  };

  env.onMessage((raw, respond) => {
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
}
