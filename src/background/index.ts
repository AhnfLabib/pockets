// Background service worker: wires chrome events to the visit state machine.
// Listeners are registered synchronously at top level, and onWake is queued before anything else,
// so an event that woke the worker is always handled after a leftover visit has been cancelled.
import { Visits } from './visit';
import { Store, forgetTab, setWorking } from './store';
import { chromeBrowser } from './chrome-browser';
import { chromeKV } from './kv';
import type { ToBackground } from '../shared/types';

const ALARM = 'pockets-tick';

const store = new Store(chromeKV);
const visits = new Visits(chromeBrowser, store, () => Date.now(), () => crypto.randomUUID());

/** Working mode shows on the toolbar icon as a small red badge. */
function paintBadge(working: boolean): void {
  void chrome.action.setBadgeText({ text: working ? ' ' : '' }).catch(() => {});
  if (working) void chrome.action.setBadgeBackgroundColor({ color: '#d9483b' }).catch(() => {});
}
void store.runtime().then((rt) => paintBadge(rt.working)).catch(() => {});

// Worker start: a stored visit belongs to a dead worker. Cancel and unmark it; close nothing.
void visits.onWake();

chrome.runtime.onStartup.addListener(() => { void visits.onWake(); });

void chrome.alarms.get(ALARM).then((a) => {
  if (!a) void chrome.alarms.create(ALARM, { periodInMinutes: 1 });
}).catch(() => {});
chrome.alarms.onAlarm.addListener((a) => { if (a.name === ALARM) void visits.tick(); });

function tabGone(tabId: number): void {
  void visits.onTabGone(tabId);
  void visits.updateRuntime((rt) => forgetTab(rt, tabId));
}
chrome.tabs.onRemoved.addListener((tabId) => tabGone(tabId));
chrome.tabs.onReplaced.addListener((_added, removed) => tabGone(removed));
chrome.tabs.onUpdated.addListener((tabId, info) => { if (info.url !== undefined) void visits.onTabChanged(tabId); });
chrome.tabs.onActivated.addListener((info) => { void visits.onTabActivated(info.tabId); });
chrome.tabs.onCreated.addListener(() => { void visits.tick(); });
chrome.windows.onFocusChanged.addListener(() => { void visits.onFocusChanged(); void visits.tick(); });

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const msg = message as { type?: unknown } | null;
  if (!msg || typeof msg !== 'object') return false;
  if (msg.type === 'pockets/ping') {
    sendResponse({ type: 'pockets/pong', from: 'background' });
    return false;
  }
  const m = msg as ToBackground;
  const tabId = sender.tab?.id;
  switch (m.type) {
    case 'pockets/event':
      // Only the top frame hosts the stage.
      if (tabId !== undefined && sender.frameId === 0 && typeof m.visitId === 'string' && m.event && typeof m.event.type === 'string') {
        void visits.onEvent(tabId, m.visitId, m.event);
      }
      break;
    case 'pockets/typed':
      // Any frame of the tab may report typing.
      if (tabId !== undefined) {
        void visits.updateRuntime((rt) => (rt.typedIn.includes(tabId) ? rt : { ...rt, typedIn: [...rt.typedIn, tabId] }));
      }
      break;
    case 'pockets/set-working':
      if (typeof m.on === 'boolean') {
        const on = m.on;
        void visits.updateRuntime((rt) => setWorking(rt, on, Date.now())).then(() => paintBadge(on)).then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false }));
        return true;
      }
      break;
    case 'pockets/undo':
      if (typeof m.takenAt === 'number' && Number.isFinite(m.takenAt)) void visits.undo(m.takenAt);
      break;
  }
  return false;
});
