// Background service worker: wires chrome events to the visit state machine.
// Listeners are registered synchronously at top level, and onWake is queued before anything else,
// so an event that woke the worker is always handled after a leftover visit has been cancelled.
import { Visits } from './visit';
import { Store, clearTyped, forgetTab, setWorking } from './store';
import { chromeBrowser } from './chrome-browser';
import { chromeKV } from './kv';
import { canUndo, isExtensionPage } from './sender';
import type { RuntimeState, Settings, ToBackground } from '../shared/types';

/** True only in a test build (POCKETS_TEST=1, see scripts/build.mjs). A normal build drops every `if` on it. */
declare const __POCKETS_TEST__: boolean;

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
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.url !== undefined) void visits.onTabChanged(tabId);
  // "Typed into since the page loaded": a new load (navigation or reload) ends the old page's protection.
  if (info.status === 'loading') void visits.updateRuntime((rt) => clearTyped(rt, tabId));
});
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
  // Only our own pages (popup, options) may change settings-like state; content scripts run on web pages.
  if (m.type === 'pockets/set-working' && !isExtensionPage(sender.url, chrome.runtime.getURL(''))) {
    sendResponse({ ok: false });
    return false;
  }
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
        void (async () => {
          await visits.updateRuntime((rt) => setWorking(rt, on, Date.now()));
          // The queue contains errors, so confirm the save landed before reporting success or painting.
          if ((await store.runtime()).working !== on) throw new Error('save failed');
          if (!on) await visits.onWorkingOff();
          paintBadge(on);
        })().then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false }));
        return true;
      }
      break;
    case 'pockets/undo':
      if (typeof m.takenAt === 'number' && Number.isFinite(m.takenAt)) {
        const takenAt = m.takenAt;
        // Extension pages, or the top frame of the tab that was shown this take's notice.
        void store.taken().then((all) => {
          if (canUndo(sender, all.find((t) => t.takenAt === takenAt), chrome.runtime.getURL(''))) return visits.undo(takenAt);
        });
      }
      break;
  }
  return false;
});

// ---- Test builds only -------------------------------------------------------------------------------------------
// The e2e hook `pockets/test-set`. scripts/build.mjs sets __POCKETS_TEST__ from POCKETS_TEST=1; in a normal build the
// constant is false and esbuild removes this whole block, message name included (README: `grep -r "pockets/test-set" dist`).
// It lets a test shrink the timings (settings are applied raw, unclamped, so staleHours can be a fraction), reset
// pacing bookkeeping, and run a tick at once. Nothing here closes tabs: tick goes through the normal visit machine.
// Accepted from this extension's own pages, or from code evaluated in this service worker by the test
// (globalThis.__pocketsTestSet); a content script on a web page is refused.
if (__POCKETS_TEST__) {
  type TestSet = {
    settings?: Partial<Settings>;
    runtime?: Partial<Pick<RuntimeState, 'lastStaleVisitEnd' | 'lastDistractingTake' | 'staleTakes'>>;
    tick?: boolean;
  };
  const KEY = 'pocketsTestSettings';
  const readOverrides = async (): Promise<Partial<Settings>> => {
    const o = (await chrome.storage.local.get(KEY))[KEY];
    return o && typeof o === 'object' ? (o as Partial<Settings>) : {};
  };
  const realSettings = store.settings.bind(store);
  store.settings = async () => ({ ...(await realSettings()), ...(await readOverrides()) });

  const testSet = async (p: TestSet): Promise<{ ok: boolean }> => {
    if (p.settings) await chrome.storage.local.set({ [KEY]: { ...(await readOverrides()), ...p.settings } });
    const r = p.runtime;
    if (r) {
      await visits.updateRuntime((rt) => ({
        ...rt,
        ...(typeof r.lastStaleVisitEnd === 'number' ? { lastStaleVisitEnd: r.lastStaleVisitEnd } : {}),
        ...(typeof r.lastDistractingTake === 'number' ? { lastDistractingTake: r.lastDistractingTake } : {}),
        ...(Array.isArray(r.staleTakes) ? { staleTakes: r.staleTakes } : {}),
      }));
    }
    if (p.tick) await visits.tick();
    return { ok: true };
  };
  (globalThis as unknown as { __pocketsTestSet: typeof testSet }).__pocketsTestSet = testSet;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const m = message as ({ type?: unknown } & TestSet) | null;
    if (!m || typeof m !== 'object' || m.type !== 'pockets/test-set') return false;
    if (!isExtensionPage(sender.url, chrome.runtime.getURL(''))) {
      sendResponse({ ok: false });
      return false;
    }
    testSet(m).then(sendResponse, () => sendResponse({ ok: false }));
    return true;
  });
}
