// Background service worker: wires chrome events to the visit state machine.
// Listeners are registered synchronously at top level, and onWake is queued before anything else,
// so an event that woke the worker is always handled after a leftover visit has been cancelled (or, when paused,
// picked up again). Notification and alarm events find their visit or taken entry in storage, so they work after a
// worker restart.
import { DEADLINE_ALARM, Visits, type Browser } from './visit';
import { Store, clearTyped, forgetTab, setWorking } from './store';
import { chromeBrowser } from './chrome-browser';
import { chromeKV } from './kv';
import { canUndo, isExtensionPage, pageLoadedTab } from './sender';
import { chromeInjectApi, injectIntoOpenTabs } from './inject';
import type { RuntimeState, Settings, ToBackground } from '../shared/types';

/** True only in a test build (POCKETS_TEST=1, see scripts/build.mjs). A normal build drops every `if` on it. */
declare const __POCKETS_TEST__: boolean;

const ALARM = 'pockets-tick';

const store = new Store(chromeKV);
/** A copy, so a test build can stand in for focus (see the test-only block below). */
const browser: Browser = { ...chromeBrowser };
const visits = new Visits(browser, store, () => Date.now(), () => crypto.randomUUID());

// Worker start: a running visit belongs to a dead worker. Cancel and unmark it; close nothing. A paused visit from this
// browser run is picked up again. Every queued step also repaints the badge ("!" while paused, the working dot, or none).
void visits.onWake();

chrome.runtime.onStartup.addListener(() => { void visits.onWake(); });

// Tabs open before install or update have no content script until they load a page: add it now, so they can host a
// visit at once. Each such tab reports itself typed in (its typing so far is unknown), so it is not taken until it
// next loads a page. Browser startup needs nothing: restored tabs load, and the declared scripts run in them.
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install' || details.reason === 'update') void injectIntoOpenTabs(chromeInjectApi);
});

void chrome.alarms.get(ALARM).then((a) => {
  if (!a) void chrome.alarms.create(ALARM, { periodInMinutes: 1 });
}).catch(() => {});
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === ALARM) void visits.tick();
  else if (a.name === DEADLINE_ALARM) void visits.onDeadline();
});

// The popup holds a port while open: when it closes, where the stage stands is checked again (an open popup counts as
// the user being here, see Visits.frontState).
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'pockets-popup' || !isExtensionPage(port.sender?.url, chrome.runtime.getURL(''))) return;
  port.onDisconnect.addListener(() => { void visits.onFocusChanged(); });
});

// The away warning (click: back to the stage) and the "stole" notification (body or button 0: Undo).
chrome.notifications?.onClicked.addListener((id) => { void visits.onNotificationClicked(id); });
chrome.notifications?.onButtonClicked.addListener((id, index) => { void visits.onNotificationButton(id, index); });

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
    case 'pockets/page-loaded': {
      // "Typed into since the page loaded": the top frame started on a new document (load or reload), so typing
      // reported for the previous document no longer protects the tab. The new page reports again if typed into.
      // Sent by content-start.js at document_start, so it always precedes any typing report for that document.
      const loaded = pageLoadedTab(sender);
      if (loaded !== undefined) void visits.updateRuntime((rt) => clearTyped(rt, loaded));
      break;
    }
    case 'pockets/set-working':
      if (typeof m.on === 'boolean') {
        const on = m.on;
        void (async () => {
          await visits.updateRuntime((rt) => setWorking(rt, on, Date.now()));
          // The queue contains errors, so confirm the save landed before reporting success or painting.
          if ((await store.runtime()).working !== on) throw new Error('save failed');
          if (!on) await visits.onWorkingOff();
          await visits.refreshBadge();
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
    /** Run the install-time injection into open tabs now (it otherwise runs only on install or update). */
    inject?: boolean;
    /** Shorten the pause grace period (ms). */
    graceMs?: number;
    /** Stand in for "no browser window is focused" (headless Chromium cannot lose focus). */
    away?: boolean;
    /** Run the focus-change handler now, as chrome.windows.onFocusChanged would. */
    focusChanged?: boolean;
  };
  const KEY = 'pocketsTestSettings';
  const FOCUS_KEY = 'pocketsTestAway';
  const GRACE_KEY = 'pocketsTestGrace';
  const simulatedAway = async (): Promise<boolean> => (await chrome.storage.local.get(FOCUS_KEY))[FOCUS_KEY] === true;
  const realFocused = chromeBrowser.browserFocused;
  const realTabs = chromeBrowser.tabsInFocusedWindow;
  browser.browserFocused = async () => ((await simulatedAway()) ? false : realFocused());
  browser.tabsInFocusedWindow = async () => ((await simulatedAway()) ? null : realTabs());
  void chrome.storage.local.get(GRACE_KEY).then((o) => { if (typeof o[GRACE_KEY] === 'number') visits.graceMs = o[GRACE_KEY]; });
  // The notification handlers, for a test to press a notification or its button (headless shows no notifications).
  (globalThis as unknown as Record<string, unknown>).__pocketsNotificationClicked = (id: string) => visits.onNotificationClicked(id);
  (globalThis as unknown as Record<string, unknown>).__pocketsNotificationButton = (id: string, i: number) => visits.onNotificationButton(id, i);
  const readOverrides = async (): Promise<Partial<Settings>> => {
    const o = (await chrome.storage.local.get(KEY))[KEY];
    return o && typeof o === 'object' ? (o as Partial<Settings>) : {};
  };
  const realSettings = store.settings.bind(store);
  store.settings = async () => ({ ...(await realSettings()), ...(await readOverrides()) });

  const testSet = async (p: TestSet): Promise<{ ok: boolean; injected?: number[] }> => {
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
    if (typeof p.graceMs === 'number') {
      visits.graceMs = p.graceMs;
      await chrome.storage.local.set({ [GRACE_KEY]: p.graceMs });
    }
    if (typeof p.away === 'boolean') await chrome.storage.local.set({ [FOCUS_KEY]: p.away });
    if (p.focusChanged) await visits.onFocusChanged();
    if (p.tick) await visits.tick();
    if (p.inject) return { ok: true, injected: await injectIntoOpenTabs(chromeInjectApi) };
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
