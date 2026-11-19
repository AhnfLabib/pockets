// The production Browser over chrome.*. Every method catches and returns a safe value; none throws
// except removeTab, whose failure the visit must see so it records nothing.
import type { TabInfo, ToContent } from '../shared/types';
import type { Browser } from './visit';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const SEND_TIMEOUT_MS = 10_000;

/** The parts of a chrome.sessions.Session the helpers read. */
export interface ClosedEntry { tab?: { url?: string; sessionId?: string } }

/** Session ids of closed tabs with this URL. */
export function closedIdsFor(closed: ClosedEntry[], url: string): string[] {
  return closed.flatMap((e) => (e.tab?.url === url && e.tab.sessionId ? [e.tab.sessionId] : []));
}

/** The newest closed tab with this URL that was not already closed before our removal (`before`). */
export function pickNewSession(closed: ClosedEntry[], url: string, before: readonly string[]): string | undefined {
  return closedIdsFor(closed, url).find((id) => !before.includes(id));
}

/** True when `sessionId` is a closed tab whose URL is `url`. */
export function sessionIsTab(closed: ClosedEntry[], sessionId: string, url: string): boolean {
  return closed.some((e) => e.tab?.sessionId === sessionId && e.tab.url === url);
}

/** The final check before closing: the tab still shows `expectedUrl`, is not about to navigate away, and is unpinned. */
export function canCloseTab(t: { url?: string; pendingUrl?: string; pinned?: boolean } | null | undefined, expectedUrl: string): boolean {
  if (!t || t.url !== expectedUrl || t.pinned) return false;
  return t.pendingUrl === undefined || t.pendingUrl === '' || t.pendingUrl === expectedUrl;
}

async function recentlyClosed(): Promise<ClosedEntry[]> {
  return chrome.sessions.getRecentlyClosed({ maxResults: chrome.sessions.MAX_SESSION_RESULTS ?? 25 });
}

/** Closed-tab session ids with the target's URL, taken just before removeTab, so an older same-URL entry is never chosen. */
let snapshot: { url: string; ids: string[] } | null = null;

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

  async removeTab(id, expectedUrl) {
    snapshot = null;
    let ids: string[] | null = null;
    try {
      ids = closedIdsFor(await recentlyClosed(), expectedUrl);
    } catch {
      ids = null; // no snapshot: Undo will open the URL instead of restoring
    }
    try {
      // The last await before the close: the tab must still be the one the visit warned about.
      const t = await chrome.tabs.get(id);
      if (!canCloseTab(t, expectedUrl)) return false;
      if (ids) snapshot = { url: expectedUrl, ids };
      await chrome.tabs.remove(id);
      return true;
    } catch {
      snapshot = null;
      return false;
    }
  },

  /** True only when the top frame's content script answered `{ ok: true }`. */
  async send(tabId: number, msg: ToContent) {
    try {
      // A reply that never comes must not hold the visit queue: give up after SEND_TIMEOUT_MS (treated as cannot receive).
      const res: unknown = await Promise.race([
        chrome.tabs.sendMessage(tabId, msg, { frameId: 0 }),
        sleep(SEND_TIMEOUT_MS).then(() => undefined),
      ]);
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

  /** The tab our last removeTab closed: a closed entry with this URL that was not in the pre-removal snapshot.
   *  The list may lag tabs.remove slightly, so poll briefly. Without a matching snapshot, give no id (Undo opens the URL). */
  async lastClosedSessionId(url) {
    const snap = snapshot;
    snapshot = null;
    if (url === undefined || !snap || snap.url !== url) return undefined;
    for (let i = 0; i < 6; i++) {
      try {
        const id = pickNewSession(await recentlyClosed(), url, snap.ids);
        if (id) return id;
      } catch {
        return undefined;
      }
      await sleep(200);
    }
    return undefined;
  },

  /** Restore only if the session entry is still a closed tab with this URL (ids can change across restarts). */
  async restore(sessionId, url) {
    try {
      if (!sessionIsTab(await recentlyClosed(), sessionId, url)) return false;
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

  async browserFocused() {
    try {
      return (await chrome.windows.getAll()).some((w) => w.focused);
    } catch {
      return true; // cannot tell: count as focused, which never allows an away take
    }
  },

  async windowMinimized(windowId) {
    try {
      return (await chrome.windows.get(windowId)).state === 'minimized';
    } catch {
      return false;
    }
  },

  async tabCountInWindow(windowId) {
    try {
      return (await chrome.tabs.query({ windowId })).length;
    } catch {
      return 0;
    }
  },

  /** True only when the notification was created. A missing or denied permission, or any error, is false. */
  async createNotification(id, n) {
    try {
      if (!chrome.notifications) return false;
      if ((await chrome.notifications.getPermissionLevel()) !== 'granted') return false;
      const created = await chrome.notifications.create(id, {
        type: 'basic', iconUrl: chrome.runtime.getURL('assets/icons/icon-128.png'), title: n.title, message: n.message,
        ...(n.buttons ? { buttons: n.buttons.map((title) => ({ title })) } : {}),
      });
      return created === id;
    } catch {
      return false;
    }
  },

  async clearNotification(id) {
    try {
      await chrome.notifications?.clear(id);
    } catch {
      /* already gone */
    }
  },

  async focusTab(tabId) {
    try {
      const t = await chrome.tabs.get(tabId);
      await chrome.windows.update(t.windowId, { focused: true });
      await chrome.tabs.update(tabId, { active: true });
    } catch {
      /* the tab or window is gone */
    }
  },

  async setAlarm(name, when) {
    try {
      await chrome.alarms.create(name, { when });
    } catch {
      /* the minute tick still checks the deadline */
    }
  },

  async clearAlarm(name) {
    try {
      await chrome.alarms.clear(name);
    } catch {
      /* nothing to clear */
    }
  },

  async setBadge(text, color) {
    try {
      await chrome.action.setBadgeText({ text });
      if (text) await chrome.action.setBadgeBackgroundColor({ color });
    } catch {
      /* cosmetic */
    }
  },

  bootId() {
    boot ??= (async () => {
      try {
        const got = (await chrome.storage.session.get(BOOT_KEY))[BOOT_KEY];
        if (typeof got === 'string' && got) return got;
        const id = crypto.randomUUID();
        await chrome.storage.session.set({ [BOOT_KEY]: id });
        return id;
      } catch {
        // Unknown run: a fresh id per worker, so a paused visit from an earlier worker is abandoned, never taken.
        return 'unknown-' + crypto.randomUUID();
      }
    })();
    return boot;
  },
};

/** chrome.storage.session lives as long as the browser run (cleared on a browser restart or extension reload). */
const BOOT_KEY = 'pocketsBootId';
let boot: Promise<string> | null = null;
