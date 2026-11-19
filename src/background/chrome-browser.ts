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

  async removeTab(id) {
    snapshot = null;
    try {
      const t = await chrome.tabs.get(id);
      if (t.url) snapshot = { url: t.url, ids: closedIdsFor(await recentlyClosed(), t.url) };
    } catch {
      snapshot = null;
    }
    await chrome.tabs.remove(id);
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
};
