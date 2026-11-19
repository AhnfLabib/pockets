// Content script: notices typing, marks its own tab, hosts the stage and relays stage events.
import { mountStage, type Stage } from '../stage/mount';
import { markTab, unmarkTab } from './mark';
import { watchTyping } from './typed';
import type { ToBackground, ToContent, VisitEvent } from '../shared/types';

const assetBase = chrome.runtime.getURL('assets/');
const iconUrl = chrome.runtime.getURL('assets/icons/icon-32.png');

function send(msg: ToBackground): void {
  try {
    void chrome.runtime.sendMessage(msg).catch(() => {});
  } catch {
    /* extension context gone */
  }
}

let stagePromise: Promise<Stage> | null = null;
let stage: Stage | null = null;
let currentVisit: string | null = null;

function getStage(): Promise<Stage> {
  if (!stagePromise) {
    stagePromise = mountStage(document, assetBase).then((s) => (stage = s));
    stagePromise.catch(() => { stagePromise = null; });
  }
  return stagePromise;
}

watchTyping(document, () => send({ type: 'pockets/typed' }));

function handle(msg: ToContent): unknown {
  switch (msg.type) {
    case 'pockets/ping':
      return { type: 'pockets/pong', from: 'content' };
    case 'pockets/play': {
      const { plan } = msg;
      currentVisit = plan.visitId;
      void getStage()
        .then((s) => s.play(plan, (event: VisitEvent) => send({ type: 'pockets/event', visitId: plan.visitId, event })))
        .catch(() => {});
      return { ok: true };
    }
    case 'pockets/cancel':
      if (stage && msg.visitId === currentVisit) stage.cancel();
      return { ok: true };
    case 'pockets/mark':
      markTab(document, msg.remaining, iconUrl);
      return { ok: true };
    case 'pockets/unmark':
      unmarkTab(document);
      return { ok: true };
    case 'pockets/notice': {
      const takenAt = msg.takenAt;
      void getStage()
        .then((s) => s.showNotice(msg.title, (event: VisitEvent) => { if (event.type === 'undo') send({ type: 'pockets/undo', takenAt }); }))
        .catch(() => {});
      return { ok: true };
    }
    default:
      return undefined;
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  try {
    const res = handle(message as ToContent);
    if (res !== undefined) sendResponse(res);
  } catch {
    try { sendResponse({ ok: false }); } catch { /* ignore */ }
  }
  return false;
});
