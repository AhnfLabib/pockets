// The production Browser over chrome.*. Every method catches and returns a safe value; none throws
// except removeTab, whose failure the visit must see so it records nothing.
import type { TabInfo, ToContent } from '../shared/types';
import type { Browser } from './visit';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function toTabInfo(t: chrome.tabs.Tab): TabInfo | null {
  if (t.id === undefined || t.id === chrome.tabs.TAB_ID_NONE) return null;
  return {
    id: t.id, windowId: t.windowId, index: t.index, url: t.url ?? '', title: t.title ?? '',
    ...(t.favIconUrl ? { favIconUrl: t.favIconUrl } : {}),
    active: t.active, pinned: t.pinned, audible: t.audible ?? false, discarded: t.discarded ?? false,
    // A tab with no lastAccessed is treated as just used, so it is never stale.
    lastAccessed: typeof t.lastAccessed === 'number' ? t.lastAccessed : Date.now(),
  };
}

export const chromeBrowser: Browser = {
  async tabsInFocusedWindow() {
    try {
      const w = await chrome.windows.getLastFocused({ populate: true, windowTypes: ['normal'] });
      if (!w || !w.focused || w.id === undefined) return null;
      const tabs = (w.tabs ?? []).map(toTabInfo).filter((t): t is TabInfo => t !== null);
      return { windowId: w.id, tabs };
    } catch {
      return null;
    }
  },

  async getTab(id) {
    try {
      return toTabInfo(await chrome.tabs.get(id));
    } catch {
      return null;
    }
  },

  async removeTab(id) {
    await chrome.tabs.remove(id);
  },

  /** True only when the top frame's content script answered `{ ok: true }`. */
  async send(tabId: number, msg: ToContent) {
    try {
      const res: unknown = await chrome.tabs.sendMessage(tabId, msg, { frameId: 0 });
      return typeof res === 'object' && res !== null && (res as { ok?: unknown }).ok === true;
    } catch {
      return false;
    }
  },

  async userActive() {
    try {
      return (await chrome.idle.queryState(60)) === 'active';
    } catch {
      return false;
    }
  },

  /** The most recently closed tab with this URL. The list may lag tabs.remove slightly, so poll briefly. */
  async lastClosedSessionId(url) {
    for (let i = 0; i < 6; i++) {
      try {
        const closed = await chrome.sessions.getRecentlyClosed({ maxResults: 10 });
        const entry = closed.find((s) => s.tab && (url === undefined || s.tab.url === url));
        if (entry?.tab?.sessionId) return entry.tab.sessionId;
      } catch {
        return undefined;
      }
      await sleep(200);
    }
    return undefined;
  },

  async restore(sessionId) {
    try {
      await chrome.sessions.restore(sessionId);
      return true;
    } catch {
      return false;
    }
  },

  async openUrl(url) {
    try {
      await chrome.tabs.create({ url });
    } catch {
      /* nothing more to do; the entry stays in history */
    }
  },
};
