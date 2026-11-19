import { canUndo } from '../../src/background/sender';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Visits, GRACE_MS, AWAY_CONFIRM_MS, DEADLINE_ALARM, AWAY_MESSAGE, TAKEN_MESSAGE, type Browser } from '../../src/background/visit';
import { Store, type KV } from '../../src/background/store';
import { chromeBrowser, pickNewSession, sessionIsTab, closedIdsFor, canCloseTab } from '../../src/background/chrome-browser';
import { DEFAULT_SETTINGS } from '../../src/shared/defaults';
import type { ActiveVisit, RuntimeState, TabInfo, ToContent, VisitPlan } from '../../src/shared/types';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const T0 = 1_800_000_000_000;

function mapKV(): KV {
  const m = new Map<string, unknown>();
  return { get: async (k) => structuredClone(m.get(k)), set: async (k, v) => { m.set(k, structuredClone(v)); } };
}

/** A fake browser that records every message and every closed tab. */
class FakeBrowser implements Browser {
  windowId = 1;
  focused = true;
  active = true;
  tabs = new Map<number, TabInfo>();
  sent: { tabId: number; msg: ToContent }[] = [];
  removed: number[] = [];
  cannotReceive = new Set<number>();
  sessionId: string | undefined = 'sess-1';
  sessionUrls: (string | undefined)[] = [];
  restoreOk = true;
  removeThrows = false;
  removeRefuses = false;
  removeUrls: string[] = [];
  restored: string[] = [];
  restoredUrls: string[] = [];
  onGetTab: ((id: number) => void) | null = null;
  opened: string[] = [];
  /** Whether any browser window is focused; null follows `focused` (the stage's normal window). */
  anyFocused: boolean | null = null;
  minimized = new Set<number>();
  notifyFails = false;
  created: { id: string; title: string; message: string; buttons?: string[] }[] = [];
  cleared: string[] = [];
  focusedTabs: number[] = [];
  alarms = new Map<string, number>();
  badges: string[] = [];
  boot = 'boot-1';

  add(t: Partial<TabInfo> & { id: number; url: string }): TabInfo {
    const tab: TabInfo = { windowId: 1, index: this.tabs.size, title: 'Tab ' + t.id, active: false, pinned: false, audible: false,
      discarded: false, lastAccessed: T0, ...t };
    this.tabs.set(tab.id, tab);
    return tab;
  }
  async tabsInFocusedWindow() {
    if (!this.focused) return null;
    return { windowId: this.windowId, tabs: [...this.tabs.values()].filter((t) => t.windowId === this.windowId).map((t) => ({ ...t })) };
  }
  async getTab(id: number) { this.onGetTab?.(id); const t = this.tabs.get(id); return t ? { ...t } : null; }
  async removeTab(id: number, expectedUrl: string) {
    this.removeUrls.push(expectedUrl);
    if (this.removeThrows) throw new Error('No tab with id');
    const t = this.tabs.get(id);
    if (this.removeRefuses || !t || t.url !== expectedUrl) return false; // the adapter's final check
    this.removed.push(id);
    this.tabs.delete(id);
    if (t?.active) {
      const next = [...this.tabs.values()].find((x) => x.windowId === t.windowId);
      if (next) next.active = true;
    }
    return true;
  }
  async send(tabId: number, msg: ToContent) {
    this.sent.push({ tabId, msg });
    return this.tabs.has(tabId) && !this.cannotReceive.has(tabId);
  }
  async userActive() { return this.active; }
  async lastClosedSessionId(url?: string) { this.sessionUrls.push(url); return this.sessionId; }
  async restore(id: string, url: string) { this.restored.push(id); this.restoredUrls.push(url); return this.restoreOk; }
  async openUrl(url: string) { this.opened.push(url); }
  async browserFocused() { return this.anyFocused ?? this.focused; }
  async windowMinimized(id: number) { return this.minimized.has(id); }
  async tabCountInWindow(id: number) { return [...this.tabs.values()].filter((t) => t.windowId === id).length; }
  async createNotification(id: string, n: { title: string; message: string; buttons?: string[] }) {
    if (this.notifyFails) return false;
    this.created.push({ id, ...n });
    return true;
  }
  onClear: ((id: string) => void) | null = null;
  async clearNotification(id: string) { this.cleared.push(id); this.onClear?.(id); }
  async focusTab(tabId: number) { this.focusedTabs.push(tabId); }
  async setAlarm(name: string, when: number) { this.alarms.set(name, when); }
  async clearAlarm(name: string) { this.alarms.delete(name); }
  async setBadge(text: string) { this.badges.push(text); }
  async bootId() { return this.boot; }

  to(tabId: number, type: ToContent['type']): ToContent[] {
    return this.sent.filter((s) => s.tabId === tabId && s.msg.type === type).map((s) => s.msg);
  }
  plans(tabId: number): VisitPlan[] {
    return this.to(tabId, 'pockets/play').map((m) => (m as { plan: VisitPlan }).plan);
  }
}

let b: FakeBrowser;
let store: Store;
let now: number;
let ids: number;
let timers: { fn: () => void; ms: number }[];
let v: Visits;

function make() {
  v = new Visits(b, store, () => now, () => 'v' + ++ids, (fn, ms) => { timers.push({ fn, ms }); });
}

beforeEach(() => {
  b = new FakeBrowser();
  store = new Store(mapKV());
  now = T0;
  ids = 0;
  timers = [];
  // Stage: the page being looked at. Target: not opened for 2 days. A fresh tab that is never a target.
  b.add({ id: 1, url: 'https://work.com/doc', title: 'Work', active: true, lastAccessed: T0 });
  b.add({ id: 2, url: 'https://old.com/page', title: 'Old page', favIconUrl: 'https://old.com/f.ico', lastAccessed: T0 - 2 * DAY });
  b.add({ id: 3, url: 'https://fresh.com/', title: 'Fresh', lastAccessed: T0 - HOUR });
  make();
});

const rt = () => store.runtime();
const visitId = async () => (await rt()).visit!.visitId;

/** Run the timers scheduled so far (deadline and away-confirm), then wait for the queue. */
async function runTimers() {
  for (const t of timers.splice(0)) t.fn();
  await v.idle();
  await v.idle();
}

/** Start a visit and show the card; returns the visit id. */
async function startShown(stage = 1): Promise<string> {
  await v.tick();
  const id = await visitId();
  await v.onEvent(stage, id, { type: 'card-shown' });
  return id;
}

describe('Visits: happy path', () => {
  it('plays on the active tab, marks the target on each tick, and on take closes exactly the target', async () => {
    await store.saveRuntime({ ...(await rt()), staleTakes: [T0 - 2 * HOUR, T0 - 30 * 60_000] });
    await v.tick();
    const plans = b.plans(1);
    expect(plans).toHaveLength(1);
    expect(plans[0]).toEqual({
      visitId: 'v1', targetTabId: 2, title: 'Old page', faviconUrl: 'https://old.com/f.ico', reason: 'stale',
      reasonText: 'not opened for 2 days', tabIndex: 1, tabCount: 3, countdownSeconds: 5, targetIsStage: false,
    });
    expect((await rt()).visit).toMatchObject({ visitId: 'v1', targetTabId: 2, targetUrl: 'https://old.com/page', stageTabId: 1,
      reason: 'stale', cardShown: false, startedAt: T0 });

    await v.onEvent(1, 'v1', { type: 'card-shown' });
    expect((await rt()).visit!.cardShown).toBe(true);
    for (const n of [3, 2, 1]) { now += 1000; await v.onEvent(1, 'v1', { type: 'tick', remaining: n }); }
    expect(b.to(2, 'pockets/mark')).toEqual([
      { type: 'pockets/mark', remaining: 3 }, { type: 'pockets/mark', remaining: 2 }, { type: 'pockets/mark', remaining: 1 }]);
    expect(b.removed).toEqual([]);

    now += 1000;
    await v.onEvent(1, 'v1', { type: 'take' });
    expect(b.removed).toEqual([2]);
    const taken = await store.taken();
    expect(taken).toEqual([{ title: 'Old page', url: 'https://old.com/page', favIconUrl: 'https://old.com/f.ico', takenAt: now,
      reason: 'stale', sessionId: 'sess-1', noticeTabId: 1 }]);
    expect(b.sessionUrls).toEqual(['https://old.com/page']);
    const r = await rt();
    expect(r.visit).toBeNull();
    expect(r.staleTakes).toEqual([T0 - 30 * 60_000, now]); // the 2 h old entry is pruned
    expect(r.lastStaleVisitEnd).toBe(now);
    expect(b.to(1, 'pockets/notice')).toEqual([{ type: 'pockets/notice', title: 'Old page', takenAt: now }]);
    expect(b.to(2, 'pockets/notice')).toEqual([]);
  });

  it('a later done for the finished visit closes nothing more', async () => {
    const id = await startShown();
    await v.onEvent(1, id, { type: 'take' });
    await v.onEvent(1, id, { type: 'done' });
    await v.onTabGone(2);
    expect(b.removed).toEqual([2]);
    expect(b.to(1, 'pockets/cancel')).toEqual([]);
  });

  it('reasonText uses hours under a day', async () => {
    await store.saveSettings({ ...DEFAULT_SETTINGS, staleHours: 1 });
    b.tabs.get(2)!.lastAccessed = T0 - 5 * HOUR;
    b.tabs.get(3)!.lastAccessed = T0;
    await v.tick();
    expect(b.plans(1)[0].reasonText).toBe('not opened for 5 hours');
  });
});

describe('Visits: no card, no close (global constraint)', () => {
  it('take without a prior card-shown removes nothing', async () => {
    await v.tick();
    const id = await visitId();
    expect(b.plans(1)).toHaveLength(1);
    await v.onEvent(1, id, { type: 'tick', remaining: 1 });
    await v.onEvent(1, id, { type: 'take' });
    await v.onEvent(1, id, { type: 'done' });
    for (const t of timers) t.fn();
    await v.idle();
    expect(b.removed).toEqual([]);
    expect(b.tabs.has(2)).toBe(true);
    expect((await rt()).visit).toBeNull();
    expect(b.to(2, 'pockets/unmark')).toHaveLength(1);
  });

  it('card-shown from a tab other than the stage does not count', async () => {
    await v.tick();
    const id = await visitId();
    await v.onEvent(3, id, { type: 'card-shown' });
    expect((await rt()).visit!.cardShown).toBe(false);
    await v.onEvent(1, id, { type: 'take' });
    expect(b.removed).toEqual([]);
  });

  it('take from a tab other than the stage is ignored', async () => {
    const id = await startShown();
    await v.onEvent(2, id, { type: 'take' });
    await v.onEvent(3, id, { type: 'take' });
    expect(b.removed).toEqual([]);
    expect((await rt()).visit!.visitId).toBe(id);
  });

  it('take with a different visit id is ignored', async () => {
    await startShown();
    await v.onEvent(1, 'other', { type: 'take' });
    expect(b.removed).toEqual([]);
  });

  it('a stored visit with a non-boolean cardShown is not treated as shown', async () => {
    await v.tick();
    const r = await rt();
    await store.saveRuntime({ ...r, visit: { ...r.visit!, cardShown: 'yes' as unknown as boolean } });
    await v.onEvent(1, r.visit!.visitId, { type: 'take' });
    expect(b.removed).toEqual([]);
  });
});

describe('Visits: stage cannot receive', () => {
  it('starts no visit, removes nothing, and the next tick tries again', async () => {
    b.cannotReceive.add(1);
    await v.tick();
    expect(b.to(1, 'pockets/play')).toHaveLength(1); // tried
    // A reply that only timed out must not leave a late stage playing: it is told to cancel.
    expect(b.to(1, 'pockets/cancel')).toEqual([{ type: 'pockets/cancel', visitId: 'v1' }]);
    let r = await rt();
    expect(r.visit).toBeNull();
    expect(r.lastStaleVisitEnd).toBe(0);
    expect(b.removed).toEqual([]);

    b.cannotReceive.delete(1);
    await v.tick();
    expect(b.to(1, 'pockets/play')).toHaveLength(2);
    r = await rt();
    expect(r.visit).not.toBeNull();
    expect(b.removed).toEqual([]);
  });

  it('starts nothing when the window is not focused or the user is idle', async () => {
    b.focused = false;
    await v.tick();
    b.focused = true;
    b.active = false;
    await v.tick();
    expect(b.sent).toEqual([]);
    expect((await rt()).visit).toBeNull();
  });
});

describe('Visits: keep', () => {
  it('removes nothing, spares the stale tab for a stale period, and unmarks the target', async () => {
    const id = await startShown();
    await v.onEvent(1, id, { type: 'tick', remaining: 5 });
    now += 2000;
    await v.onEvent(1, id, { type: 'keep' });
    expect(b.removed).toEqual([]);
    const r = await rt();
    expect(r.visit).toBeNull();
    expect(r.spared[2]).toEqual({ until: now + 24 * HOUR });
    expect(b.to(2, 'pockets/unmark')).toHaveLength(1);
    expect(await store.taken()).toEqual([]);
    await v.onEvent(1, id, { type: 'take' });
    expect(b.removed).toEqual([]);
  });
});

describe('Visits: close failure', () => {
  it('if removeTab throws, nothing is recorded and nothing is counted', async () => {
    const id = await startShown();
    b.removeThrows = true;
    await v.onEvent(1, id, { type: 'take' });
    expect(await store.taken()).toEqual([]);
    const r = await rt();
    expect(r.staleTakes).toEqual([]);
    expect(r.visit).toBeNull();
    expect(b.to(1, 'pockets/notice')).toEqual([]);
  });
});

describe('Visits: asleep target', () => {
  it('a failed mark is not fatal: the tab is still taken on take', async () => {
    b.cannotReceive.add(2);
    const id = await startShown();
    await v.onEvent(1, id, { type: 'tick', remaining: 3 });
    expect(b.to(2, 'pockets/mark')).toHaveLength(1);
    expect((await rt()).visit).not.toBeNull();
    await v.onEvent(1, id, { type: 'take' });
    expect(b.removed).toEqual([2]);
  });
});

describe('Visits: target gone or changed (Review Focus 2)', () => {
  it('target closed before take: cancelled on the stage, nothing removed, visit null', async () => {
    const id = await startShown();
    b.tabs.delete(2);
    await v.onTabGone(2);
    expect(b.to(1, 'pockets/cancel')).toEqual([{ type: 'pockets/cancel', visitId: id }]);
    expect((await rt()).visit).toBeNull();
    await v.onEvent(1, id, { type: 'take' });
    expect(b.removed).toEqual([]);
  });

  it('target navigated before take: cancelled, unmarked, nothing removed, visit null', async () => {
    const id = await startShown();
    b.tabs.get(2)!.url = 'https://old.com/other';
    await v.onTabChanged(2);
    expect(b.to(1, 'pockets/cancel')).toEqual([{ type: 'pockets/cancel', visitId: id }]);
    expect(b.to(2, 'pockets/unmark')).toHaveLength(1);
    expect((await rt()).visit).toBeNull();
    await v.onEvent(1, id, { type: 'take' });
    expect(b.removed).toEqual([]);
  });

  it('at take, the tab id holds a different URL than targetUrl: nothing removed', async () => {
    const id = await startShown();
    b.tabs.get(2)!.url = 'https://old.com/elsewhere';
    await v.onEvent(1, id, { type: 'take' });
    expect(b.removed).toEqual([]);
    expect(b.to(1, 'pockets/cancel')).toEqual([{ type: 'pockets/cancel', visitId: id }]);
    expect((await rt()).visit).toBeNull();
  });

  it('at take, the target has gone without an event: nothing removed', async () => {
    const id = await startShown();
    b.tabs.delete(2);
    await v.onEvent(1, id, { type: 'take' });
    expect(b.removed).toEqual([]);
    expect((await rt()).visit).toBeNull();
  });

  it('at take, the target was moved to another window or pinned: nothing removed', async () => {
    let id = await startShown();
    b.tabs.get(2)!.windowId = 9;
    await v.onEvent(1, id, { type: 'take' });
    expect(b.removed).toEqual([]);

    b.tabs.get(2)!.windowId = 1;
    now += HOUR; // past the stale gap
    id = await startShown();
    b.tabs.get(2)!.pinned = true;
    await v.onEvent(1, id, { type: 'take' });
    expect(b.removed).toEqual([]);
  });

  it('an aborted stale visit still counts as a visit for the gap', async () => {
    await startShown();
    await v.onTabGone(2);
    expect((await rt()).lastStaleVisitEnd).toBe(now);
  });
});

describe('Visits: stage gone or navigated (Review Focus 4)', () => {
  it('stage closed before take: nothing removed, the target is unmarked', async () => {
    const id = await startShown();
    b.tabs.delete(1);
    await v.onTabGone(1);
    expect(b.to(2, 'pockets/unmark')).toHaveLength(1);
    expect((await rt()).visit).toBeNull();
    await v.onEvent(1, id, { type: 'take' });
    expect(b.removed).toEqual([]);
  });

  it('stage navigated before take: nothing removed, the target is unmarked', async () => {
    const id = await startShown();
    b.tabs.get(1)!.url = 'https://work.com/next';
    await v.onTabChanged(1);
    expect(b.to(2, 'pockets/unmark')).toHaveLength(1);
    expect((await rt()).visit).toBeNull();
    await v.onEvent(1, id, { type: 'take' });
    expect(b.removed).toEqual([]);
  });

  it('an unrelated tab changing or closing does not touch the visit', async () => {
    const id = await startShown();
    await v.onTabChanged(3);
    await v.onTabGone(3);
    expect((await rt()).visit!.visitId).toBe(id);
  });
});

describe('Visits: worker restart (Review Focus 3)', () => {
  it('onWake with a stored visit unmarks and cancels, closes nothing, visit null', async () => {
    const stored: ActiveVisit = { visitId: 'v0', targetTabId: 2, targetUrl: 'https://old.com/page', stageTabId: 1, reason: 'stale',
      cardShown: true, startedAt: T0 - 5000 };
    await store.saveRuntime({ ...(await rt()), visit: stored });
    make(); // a fresh worker
    await v.onWake();
    expect(b.to(2, 'pockets/unmark')).toHaveLength(1);
    expect(b.to(1, 'pockets/cancel')).toEqual([{ type: 'pockets/cancel', visitId: 'v0' }]);
    expect(b.removed).toEqual([]);
    expect((await rt()).visit).toBeNull();
    await v.onEvent(1, 'v0', { type: 'take' });
    expect(b.removed).toEqual([]);
  });

  it('onWake without a visit sends nothing', async () => {
    await v.onWake();
    expect(b.sent).toEqual([]);
  });
});

describe('Visits: the user switches to the target mid-countdown', () => {
  it('a stale target is treated as Keep', async () => {
    const id = await startShown();
    await v.onEvent(1, id, { type: 'tick', remaining: 4 });
    b.tabs.get(1)!.active = false;
    b.tabs.get(2)!.active = true;
    await v.onTabActivated(2);
    expect(b.removed).toEqual([]);
    const r = await rt();
    expect(r.visit).toBeNull();
    expect(r.spared[2]).toEqual({ until: now + 24 * HOUR });
    expect(b.to(2, 'pockets/unmark')).toHaveLength(1);
    expect(b.to(1, 'pockets/cancel')).toEqual([{ type: 'pockets/cancel', visitId: id }]);
    await v.onEvent(1, id, { type: 'take' });
    expect(b.removed).toEqual([]);
  });

  describe('a distracting target', () => {
    it('kept: spared until working mode is next switched on', async () => {
      const id = await startShown();
      await v.onEvent(1, id, { type: 'keep' });
      expect(b.removed).toEqual([]);
      const r = await rt();
      expect(r.spared[4]).toEqual({ workingSince: T0 - HOUR });
      expect(r.visit).toBeNull();
    });

    beforeEach(async () => {
      await store.saveRuntime({ ...(await rt()), working: true, workingSince: T0 - HOUR });
      b.add({ id: 4, url: 'https://www.youtube.com/watch?v=x', title: 'Video', lastAccessed: T0 - 60_000 });
    });

    async function replay(): Promise<{ oldId: string; newId: string }> {
      const oldId = await startShown();
      expect(b.plans(1)[0]).toMatchObject({ targetTabId: 4, reason: 'distracting', reasonText: 'distracting', tabIndex: 3, tabCount: 4,
        targetIsStage: false });
      for (const n of [5, 4, 3]) await v.onEvent(1, oldId, { type: 'tick', remaining: n });
      b.tabs.get(1)!.active = false;
      b.tabs.get(4)!.active = true;
      await v.onTabActivated(4);
      const newId = (await rt()).visit?.visitId ?? '';
      return { oldId, newId };
    }

    it('is not saved; the visit replays with that tab as stage and the remaining seconds', async () => {
      const { oldId, newId } = await replay();
      expect(newId).not.toBe(oldId);
      expect(b.to(1, 'pockets/cancel')).toEqual([{ type: 'pockets/cancel', visitId: oldId }]);
      expect(b.plans(4)).toEqual([expect.objectContaining({ visitId: newId, targetTabId: 4, targetIsStage: true, countdownSeconds: 3,
        title: 'Video', reason: 'distracting' })]);
      const r = await rt();
      expect(r.spared[4]).toBeUndefined();
      expect(r.visit).toMatchObject({ visitId: newId, targetTabId: 4, stageTabId: 4, cardShown: false });
      expect(b.removed).toEqual([]);
    });

    it('after replay, take with the old visit id, or before the new card is shown, removes nothing', async () => {
      const { oldId, newId } = await replay();
      await v.onEvent(1, oldId, { type: 'take' });
      expect(b.removed).toEqual([]);
      await v.onEvent(4, newId, { type: 'take' });
      await v.onEvent(4, newId, { type: 'done' });
      for (const t of timers) t.fn();
      await v.idle();
      expect(b.removed).toEqual([]);
    });

    it('after replay and a new card-shown, take then done closes the target', async () => {
      const { newId } = await replay();
      await v.onEvent(4, newId, { type: 'card-shown' });
      await v.onEvent(4, newId, { type: 'take' });
      expect(b.removed).toEqual([]);
      await v.onEvent(4, newId, { type: 'done' });
      expect(b.removed).toEqual([4]);
      const r = await rt();
      expect(r.lastDistractingTake).toBe(now);
      expect(r.staleTakes).toEqual([]);
    });

    it('if the new stage cannot receive, the visit ends and nothing is closed', async () => {
      b.cannotReceive.add(4);
      await replay();
      expect((await rt()).visit).toBeNull();
      expect(b.removed).toEqual([]);
    });
  });
});

describe('Visits: target is the stage', () => {
  beforeEach(async () => {
    await store.saveRuntime({ ...(await rt()), working: true, workingSince: T0 - HOUR });
    b.tabs.get(1)!.active = false;
    b.add({ id: 4, url: 'https://reddit.com/r/x', title: 'Reddit', active: true, lastAccessed: T0 });
  });

  it('on take the tab is removed only after done, and the notice goes to the tab active afterwards', async () => {
    await v.tick();
    expect(b.plans(4)).toEqual([expect.objectContaining({ targetTabId: 4, targetIsStage: true, reason: 'distracting' })]);
    const id = await visitId();
    await v.onEvent(4, id, { type: 'card-shown' });
    await v.onEvent(4, id, { type: 'take' });
    expect(b.removed).toEqual([]);
    expect(timers.map((t) => t.ms)).toEqual([800]);
    now += 300;
    await v.onEvent(4, id, { type: 'done' });
    expect(b.removed).toEqual([4]);
    expect(b.to(1, 'pockets/notice')).toEqual([{ type: 'pockets/notice', title: 'Reddit', takenAt: now }]);
    expect(b.to(4, 'pockets/notice')).toEqual([]);
    expect((await store.taken())[0]).toMatchObject({ url: 'https://reddit.com/r/x', reason: 'distracting' });
    // The 800 ms timer firing afterwards is a no-op.
    timers[0].fn();
    await v.idle();
    expect(b.removed).toEqual([4]);
  });

  it('on take the tab is removed after 800 ms if done never comes', async () => {
    await v.tick();
    const id = await visitId();
    await v.onEvent(4, id, { type: 'card-shown' });
    await v.onEvent(4, id, { type: 'take' });
    expect(b.removed).toEqual([]);
    timers[0].fn();
    await v.idle();
    expect(b.removed).toEqual([4]);
    await v.onEvent(4, id, { type: 'done' });
    expect(b.removed).toEqual([4]);
  });

  it('a stage-target typed into during the countdown is not removed', async () => {
    await v.tick();
    const id = await visitId();
    await v.onEvent(4, id, { type: 'card-shown' });
    await v.updateRuntime((r) => ({ ...r, typedIn: [...r.typedIn, 4] }));
    await v.onEvent(4, id, { type: 'take' });
    await v.onEvent(4, id, { type: 'done' });
    for (const t of timers) t.fn();
    await v.idle();
    expect(b.removed).toEqual([]);
    expect((await rt()).visit).toBeNull();
  });

  it('typed into between take and done: not removed', async () => {
    await v.tick();
    const id = await visitId();
    await v.onEvent(4, id, { type: 'card-shown' });
    await v.onEvent(4, id, { type: 'take' });
    await v.updateRuntime((r) => ({ ...r, typedIn: [...r.typedIn, 4] }));
    await v.onEvent(4, id, { type: 'done' });
    expect(b.removed).toEqual([]);
  });

  it('a stage-target that navigated between take and done is not removed', async () => {
    await v.tick();
    const id = await visitId();
    await v.onEvent(4, id, { type: 'card-shown' });
    await v.onEvent(4, id, { type: 'take' });
    b.tabs.get(4)!.url = 'https://reddit.com/r/y';
    timers[0].fn();
    await v.idle();
    expect(b.removed).toEqual([]);
  });
});

describe('Visits: one at a time', () => {
  it('a second tick during a visit starts nothing', async () => {
    await v.tick();
    b.add({ id: 5, url: 'https://older.com/', lastAccessed: T0 - 3 * DAY });
    await v.tick();
    expect(b.sent.filter((s) => s.msg.type === 'pockets/play')).toHaveLength(1);
  });

  it('concurrent ticks start only one visit', async () => {
    await Promise.all([v.tick(), v.tick(), v.tick()]);
    expect(b.sent.filter((s) => s.msg.type === 'pockets/play')).toHaveLength(1);
  });
});

describe('Visits: undo', () => {
  beforeEach(async () => {
    await store.addTaken({ title: 'A', url: 'https://a.com/', takenAt: 100, reason: 'stale', sessionId: 's1' });
    await store.addTaken({ title: 'B', url: 'https://b.com/', takenAt: 200, reason: 'stale' });
  });

  it('restores the session and removes the entry', async () => {
    await v.undo(100);
    expect(b.restored).toEqual(['s1']);
    expect(b.restoredUrls).toEqual(['https://a.com/']);
    expect(b.opened).toEqual([]);
    expect((await store.taken()).map((t) => t.takenAt)).toEqual([200]);
  });

  it('opens the url when restore fails, and removes the entry', async () => {
    b.restoreOk = false;
    await v.undo(100);
    expect(b.restored).toEqual(['s1']);
    expect(b.opened).toEqual(['https://a.com/']);
    expect((await store.taken()).map((t) => t.takenAt)).toEqual([200]);
  });

  it('opens the url when there is no session id', async () => {
    await v.undo(200);
    expect(b.opened).toEqual(['https://b.com/']);
    expect((await store.taken()).map((t) => t.takenAt)).toEqual([100]);
  });
});

describe('Visits: abandoned after 60 s without an event', () => {
  it('is abandoned as in onWake', async () => {
    const id = await startShown();
    now += 59_000;
    await v.tick();
    expect((await rt()).visit).not.toBeNull();
    now += 1_000;
    await v.tick();
    expect(b.to(2, 'pockets/unmark')).toHaveLength(1);
    expect(b.to(1, 'pockets/cancel')).toEqual([{ type: 'pockets/cancel', visitId: id }]);
    expect((await rt()).visit).toBeNull();
    expect(b.removed).toEqual([]);
    await v.onEvent(1, id, { type: 'take' });
    expect(b.removed).toEqual([]);
  });
});

describe('Visits: updateRuntime', () => {
  it('applies a change inside the queue without losing the visit', async () => {
    await v.tick();
    await v.updateRuntime((r: RuntimeState) => ({ ...r, typedIn: [...r.typedIn, 3] }));
    const r = await rt();
    expect(r.typedIn).toEqual([3]);
    expect(r.visit).not.toBeNull();
  });
});

describe('Visits: in-page undo end to end', () => {
  it('records the notice tab; undo is allowed from it only', async () => {
    const id = await startShown();
    await v.onEvent(1, id, { type: 'take' });
    const entry = (await store.taken())[0];
    expect(entry.noticeTabId).toBe(1);
    expect(b.to(1, 'pockets/notice')).toHaveLength(1);
    const senderOk = { url: 'https://work.com/doc', frameId: 0, tab: { id: 1 } };
    const senderOther = { url: 'https://fresh.com/', frameId: 0, tab: { id: 3 } };
    if (canUndo(senderOther, entry, 'chrome-extension://x/')) await v.undo(entry.takenAt);
    expect(b.opened).toEqual([]);
    expect(b.restored).toEqual([]);
    if (canUndo(senderOk, entry, 'chrome-extension://x/')) await v.undo(entry.takenAt);
    expect(b.restored).toEqual(['sess-1']);
  });
});

describe('Visits: working mode switched off', () => {
  it('cancels a distracting visit: closes nothing, spares nothing, no gap', async () => {
    await store.saveRuntime({ ...(await rt()), working: true, workingSince: T0 - HOUR });
    b.add({ id: 4, url: 'https://www.youtube.com/watch?v=x', title: 'Video', lastAccessed: T0 - 60_000 });
    const id = await startShown();
    expect((await rt()).visit!.reason).toBe('distracting');
    await store.saveRuntime({ ...(await rt()), working: false });
    await v.onWorkingOff();
    const r = await rt();
    expect(b.removed).toEqual([]);
    expect(r.visit).toBeNull();
    expect(r.spared[4]).toBeUndefined();
    expect(r.lastStaleVisitEnd).toBe(0);
    expect(b.to(1, 'pockets/cancel')).toEqual([{ type: 'pockets/cancel', visitId: id }]);
    expect(b.to(4, 'pockets/unmark')).toHaveLength(1);
  });
  it('leaves a stale visit alone', async () => {
    const id = await startShown();
    await v.onWorkingOff();
    expect((await rt()).visit!.visitId).toBe(id);
    expect(b.to(1, 'pockets/cancel')).toEqual([]);
  });
});

describe('Fix round 1', () => {
  it('hard rule 6: an event arriving after 60 s of silence abandons the visit and closes nothing', async () => {
    const id = await startShown();
    now += 90_000;
    await v.onEvent(1, id, { type: 'take' });
    expect(b.removed).toEqual([]);
    expect((await rt()).visit).toBeNull();
    expect(b.to(1, 'pockets/cancel')).toEqual([{ type: 'pockets/cancel', visitId: id }]);
    expect(b.to(2, 'pockets/unmark')).toHaveLength(1);
  });

  it('a tick event within 60 s keeps the visit alive', async () => {
    const id = await startShown();
    now += 50_000;
    await v.onEvent(1, id, { type: 'tick', remaining: 2 });
    now += 50_000;
    await v.onEvent(1, id, { type: 'take' });
    expect(b.removed).toEqual([2]);
  });

  describe('switching away from the stage mid-countdown pauses (release B: no longer cancels)', () => {
    /** Paused: nothing removed, the stage told to cancel, the target unmarked, card-shown reset, badge "!". */
    async function expectPaused(id: string) {
      expect(b.removed).toEqual([]);
      const r = await rt();
      expect(r.visit?.visitId).toBe(id);
      expect(r.visit?.pause).toMatchObject({ at: now, bootId: 'boot-1', windowId: 1 });
      expect(r.visit?.cardShown).toBe(false);
      expect(r.spared).toEqual({});
      expect(b.to(1, 'pockets/cancel')).toEqual([{ type: 'pockets/cancel', visitId: id }]);
      expect(b.to(2, 'pockets/unmark')).toHaveLength(1);
      expect(b.badges.at(-1)).toBe('!');
      await v.onEvent(1, id, { type: 'take' });
      expect(b.removed).toEqual([]);
    }

    it('stage deactivated after card-shown: paused, nothing removed, no notification', async () => {
      const id = await startShown();
      b.tabs.get(1)!.active = false;
      b.tabs.get(3)!.active = true;
      await v.onTabActivated(3);
      await expectPaused(id);
      await runTimers();
      expect(b.created).toEqual([]);
    });

    it('window blur after card-shown: paused, nothing removed', async () => {
      const id = await startShown();
      b.focused = false;
      await v.onFocusChanged();
      await expectPaused(id);
    });

    it('stage not active when take arrives (no activation event delivered): paused, nothing removed', async () => {
      const id = await startShown();
      b.tabs.get(1)!.active = false;
      b.tabs.get(3)!.active = true;
      await v.onEvent(1, id, { type: 'take' });
      await expectPaused(id);
    });

    it('window not focused when take arrives: paused, nothing removed', async () => {
      const id = await startShown();
      b.focused = false;
      await v.onEvent(1, id, { type: 'take' });
      await expectPaused(id);
    });

    it('stage already hidden when card-shown arrives: paused; coming back replays the visit', async () => {
      await v.tick();
      const id = await visitId();
      b.tabs.get(1)!.active = false;
      b.tabs.get(3)!.active = true;
      await v.onEvent(1, id, { type: 'card-shown' });
      await expectPaused(id);
      b.tabs.get(3)!.active = false;
      b.tabs.get(1)!.active = true;
      await v.onTabActivated(1);
      expect(b.to(1, 'pockets/play')).toHaveLength(2);
      expect((await rt()).visit!.pause).toBeUndefined();
    });

    it('a stale visit paused by a tab switch and never resumed ends quietly after 5 min and starts the gap', async () => {
      await startShown();
      const pausedAt = now;
      b.tabs.get(1)!.active = false;
      b.tabs.get(3)!.active = true;
      await v.onTabActivated(3);
      now = pausedAt + GRACE_MS;
      await v.onDeadline();
      expect(b.removed).toEqual([]);
      expect((await rt()).visit).toBeNull();
      expect((await rt()).lastStaleVisitEnd).toBe(now);
      b.tabs.get(3)!.active = false;
      b.tabs.get(1)!.active = true;
      now += 60_000;
      await v.tick();
      expect(b.to(1, 'pockets/play')).toHaveLength(1);
      now = pausedAt + GRACE_MS + 5 * 60_000;
      await v.tick();
      expect(b.to(1, 'pockets/play')).toHaveLength(2);
      expect(b.removed).toEqual([]);
    });

    it('focus change while the stage stays in front leaves the visit alone', async () => {
      const id = await startShown();
      await v.onFocusChanged();
      await v.onTabActivated(1);
      expect((await rt()).visit!.visitId).toBe(id);
    });
  });

  it('hard rule 2: the URL changes between the take check and the close: nothing removed', async () => {
    const id = await startShown();
    let calls = 0;
    b.onGetTab = (tabId) => { if (tabId === 2 && ++calls === 2) b.tabs.get(2)!.url = 'https://old.com/moved-on'; };
    await v.onEvent(1, id, { type: 'take' });
    expect(calls).toBeGreaterThanOrEqual(2);
    expect(b.removed).toEqual([]);
    expect(b.removeUrls).toEqual([]); // removeTab was never asked
    expect(await store.taken()).toEqual([]);
    expect((await rt()).visit).toBeNull();
    expect(b.to(1, 'pockets/cancel')).toEqual([{ type: 'pockets/cancel', visitId: id }]);
  });

  it('card-shown is persisted', async () => {
    await startShown();
    expect((await rt()).visit!.cardShown).toBe(true);
  });
});

describe('session matching helpers', () => {
  const tab = (sessionId: string, url: string) => ({ tab: { sessionId, url } });

  it('pickNewSession skips an older same-URL entry that was closed before our removal', () => {
    const before = closedIdsFor([tab('old', 'https://a.com/'), tab('x', 'https://b.com/')], 'https://a.com/');
    expect(before).toEqual(['old']);
    // After removal the list has a newer entry first; but if it lags, only the old one is there.
    expect(pickNewSession([tab('old', 'https://a.com/')], 'https://a.com/', before)).toBeUndefined();
    expect(pickNewSession([tab('new', 'https://a.com/'), tab('old', 'https://a.com/')], 'https://a.com/', before)).toBe('new');
    expect(pickNewSession([tab('old', 'https://a.com/'), tab('new', 'https://a.com/')], 'https://a.com/', before)).toBe('new');
    expect(pickNewSession([tab('y', 'https://b.com/')], 'https://a.com/', [])).toBeUndefined();
    expect(pickNewSession([{}, tab('z', 'https://a.com/')], 'https://a.com/', [])).toBe('z');
  });

  it('sessionIsTab requires both the id and the URL to match', () => {
    const closed = [tab('s1', 'https://a.com/'), tab('s2', 'https://b.com/')];
    expect(sessionIsTab(closed, 's1', 'https://a.com/')).toBe(true);
    expect(sessionIsTab(closed, 's1', 'https://b.com/')).toBe(false);
    expect(sessionIsTab(closed, 's9', 'https://a.com/')).toBe(false);
  });
});

describe('chrome adapter send', () => {
  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as { chrome?: unknown }).chrome;
  });

  function stub(sendMessage: () => Promise<unknown>) {
    (globalThis as { chrome?: unknown }).chrome = { tabs: { sendMessage } };
  }

  it('a reply that never comes resolves false after the timeout', async () => {
    vi.useFakeTimers();
    stub(() => new Promise(() => {}));
    const p = chromeBrowser.send(1, { type: 'pockets/ping' });
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(p).resolves.toBe(false);
  });

  it('true only for { ok: true }', async () => {
    stub(async () => ({ ok: true }));
    expect(await chromeBrowser.send(1, { type: 'pockets/unmark' })).toBe(true);
    stub(async () => ({ ok: false }));
    expect(await chromeBrowser.send(1, { type: 'pockets/unmark' })).toBe(false);
    stub(async () => undefined);
    expect(await chromeBrowser.send(1, { type: 'pockets/unmark' })).toBe(false);
    stub(() => Promise.reject(new Error('no receiver')));
    expect(await chromeBrowser.send(1, { type: 'pockets/unmark' })).toBe(false);
  });
});

describe('Fix round 2: removeTab checks the URL itself', () => {
  it('the happy path passes the target URL to removeTab', async () => {
    const id = await startShown();
    await v.onEvent(1, id, { type: 'take' });
    expect(b.removeUrls).toEqual(['https://old.com/page']);
    expect(b.removed).toEqual([2]);
  });

  it('removeTab returning false: nothing recorded or counted, visit cleared, stage told to cancel, no notice', async () => {
    const id = await startShown();
    b.removeRefuses = true;
    await v.onEvent(1, id, { type: 'take' });
    expect(b.removeUrls).toEqual(['https://old.com/page']);
    expect(b.removed).toEqual([]);
    expect(await store.taken()).toEqual([]);
    const r = await rt();
    expect(r.visit).toBeNull();
    expect(r.staleTakes).toEqual([]);
    expect(b.to(1, 'pockets/cancel')).toEqual([{ type: 'pockets/cancel', visitId: id }]);
    expect(b.to(2, 'pockets/unmark')).toHaveLength(1);
    expect(b.to(1, 'pockets/notice')).toEqual([]);
  });

  it('removeTab returning false for a stage-target: nothing recorded, the stage is told to cancel', async () => {
    await store.saveRuntime({ ...(await rt()), working: true, workingSince: T0 - HOUR });
    b.tabs.get(1)!.active = false;
    b.add({ id: 4, url: 'https://reddit.com/r/x', title: 'Reddit', active: true, lastAccessed: T0 });
    await v.tick();
    const id = await visitId();
    await v.onEvent(4, id, { type: 'card-shown' });
    await v.onEvent(4, id, { type: 'take' });
    b.removeRefuses = true;
    await v.onEvent(4, id, { type: 'done' });
    expect(b.removed).toEqual([]);
    expect(await store.taken()).toEqual([]);
    expect((await rt()).lastDistractingTake).toBe(0);
    expect(b.to(4, 'pockets/cancel')).toEqual([{ type: 'pockets/cancel', visitId: id }]);
  });

  it('canCloseTab: only the same URL, unpinned, not navigating elsewhere', () => {
    const u = 'https://a.com/p';
    expect(canCloseTab({ url: u, pinned: false }, u)).toBe(true);
    expect(canCloseTab({ url: u, pinned: false, pendingUrl: u }, u)).toBe(true);
    expect(canCloseTab({ url: 'https://a.com/redirected', pinned: false }, u)).toBe(false);
    expect(canCloseTab({ url: u, pinned: true }, u)).toBe(false);
    expect(canCloseTab({ url: u, pinned: false, pendingUrl: 'https://a.com/next' }, u)).toBe(false);
    expect(canCloseTab(null, u)).toBe(false);
  });

  describe('chrome adapter removeTab', () => {
    afterEach(() => { delete (globalThis as { chrome?: unknown }).chrome; });
    function stub(tabUrl: string) {
      const removed: number[] = [];
      (globalThis as { chrome?: unknown }).chrome = {
        tabs: { get: async (id: number) => ({ id, url: tabUrl, pinned: false }), remove: async (id: number) => { removed.push(id); } },
        sessions: { MAX_SESSION_RESULTS: 25, getRecentlyClosed: async () => [] },
      };
      return removed;
    }

    it('closes when the URL still matches', async () => {
      const removed = stub('https://a.com/p');
      expect(await chromeBrowser.removeTab(7, 'https://a.com/p')).toBe(true);
      expect(removed).toEqual([7]);
    });

    it('refuses, without calling tabs.remove, when the tab has redirected', async () => {
      const removed = stub('https://a.com/redirected');
      expect(await chromeBrowser.removeTab(7, 'https://a.com/p')).toBe(false);
      expect(removed).toEqual([]);
    });
  });
});

describe('Visits: the card was hidden when the take was due', () => {
  it('hidden after card-shown: nothing removed, visit cleared, target unmarked, nothing spared, the gap starts', async () => {
    const id = await startShown();
    for (const n of [3, 2, 1]) { now += 1000; await v.onEvent(1, id, { type: 'tick', remaining: n }); }
    now += 1000;
    await v.onEvent(1, id, { type: 'hidden' });
    const r = await rt();
    expect(b.removed).toEqual([]);
    expect(r.visit).toBeNull();
    expect(r.spared).toEqual({});
    expect(r.lastStaleVisitEnd).toBe(now);
    expect(await store.taken()).toEqual([]);
    expect(b.to(2, 'pockets/unmark')).toHaveLength(1);
    expect(b.to(1, 'pockets/cancel')).toEqual([{ type: 'pockets/cancel', visitId: id }]);
    // A take arriving afterwards for the same visit closes nothing.
    await v.onEvent(1, id, { type: 'take' });
    expect(b.removed).toEqual([]);
  });

  it('hidden for a distracting visit: nothing removed, nothing spared, no gap', async () => {
    await store.saveRuntime({ ...(await rt()), working: true, workingSince: T0 - HOUR });
    b.add({ id: 4, url: 'https://www.youtube.com/watch?v=x', title: 'Video', lastAccessed: T0 - 60_000 });
    const id = await startShown();
    expect((await rt()).visit!.reason).toBe('distracting');
    await v.onEvent(1, id, { type: 'hidden' });
    const r = await rt();
    expect(b.removed).toEqual([]);
    expect(r.visit).toBeNull();
    expect(r.spared[4]).toBeUndefined();
    expect(r.lastStaleVisitEnd).toBe(0);
  });
});

describe('Visits: alive during a long climb', () => {
  /** A 50 s climb, then (at 61 s) the minute alarm's tick, then card-shown, the countdown and the take. */
  async function longClimb(sendAlive: boolean): Promise<string> {
    await v.tick();
    const id = await visitId();
    const sentBefore = b.sent.length;
    for (let s = 10; s <= 50; s += 10) {
      now = T0 + s * 1000;
      if (sendAlive) await v.onEvent(1, id, { type: 'alive' });
    }
    if (sendAlive) {
      // alive refreshes the silence clock and does nothing else.
      expect(b.sent.length).toBe(sentBefore);
      expect((await rt()).visit).toMatchObject({ visitId: id, cardShown: false });
    }
    now = T0 + 61_000;
    await v.tick();
    now = T0 + 62_000;
    await v.onEvent(1, id, { type: 'card-shown' });
    for (const n of [3, 2, 1]) { now += 1000; await v.onEvent(1, id, { type: 'tick', remaining: n }); }
    now += 1000;
    await v.onEvent(1, id, { type: 'take' });
    return id;
  }

  it('keeps the visit across a 50 s climb with alive every 10 s; the take then closes the target', async () => {
    await longClimb(true);
    expect(b.removed).toEqual([2]);
    expect(b.to(1, 'pockets/cancel')).toEqual([]);
  });

  it('control: the same climb without alive is abandoned at the 61 s tick and closes nothing', async () => {
    const id = await longClimb(false);
    expect(b.removed).toEqual([]);
    expect(b.to(1, 'pockets/cancel')).toEqual([{ type: 'pockets/cancel', visitId: id }]);
    expect((await rt()).visit).toBeNull();
  });

  it('alive from a tab other than the stage does not refresh the visit', async () => {
    await v.tick();
    const id = await visitId();
    for (let s = 10; s <= 50; s += 10) { now = T0 + s * 1000; await v.onEvent(3, id, { type: 'alive' }); }
    now = T0 + 61_000;
    await v.tick();
    expect((await rt()).visit).toBeNull();
  });
});

describe('Visits: typed-in protection lasts until the page loads again', () => {
  it('a typed-in stale tab is skipped; after clearTyped (status loading) it is taken', async () => {
    const { clearTyped } = await import('../../src/background/store');
    await v.updateRuntime((r) => ({ ...r, typedIn: [2] }));
    await v.tick();
    expect((await rt()).visit, 'tab 2 is protected and tab 3 is not stale').toBeNull();
    await v.updateRuntime((r) => clearTyped(r, 2));
    expect((await rt()).typedIn).toEqual([]);
    const id = await startShown();
    expect((await rt()).visit!.targetTabId).toBe(2);
    await v.onEvent(1, id, { type: 'take' });
    expect(b.removed).toEqual([2]);
  });
});

describe('Visits: same-document URL changes keep typed-in protection', () => {
  it('a pushState-style URL update (onTabChanged) on a typed-in tab leaves typedIn alone', async () => {
    await v.updateRuntime((r) => ({ ...r, typedIn: [2] }));
    b.tabs.get(2)!.url = 'https://old.com/page#route-2';
    await v.onTabChanged(2);
    expect((await rt()).typedIn).toEqual([2]);
    await v.tick();
    expect((await rt()).visit, 'still protected').toBeNull();
  });
});

describe('Visits: the card never came on screen', () => {
  it('hidden before any card-shown: abandoned, visit cleared, nothing removed, gap starts', async () => {
    await v.tick();
    const id = await visitId();
    now += 10_000;
    await v.onEvent(1, id, { type: 'alive' });
    now += 2_000;
    await v.onEvent(1, id, { type: 'hidden' });
    const r = await rt();
    expect(r.visit).toBeNull();
    expect(b.removed).toEqual([]);
    expect(r.spared).toEqual({});
    expect(r.lastStaleVisitEnd).toBe(now);
    expect(b.to(1, 'pockets/cancel')).toEqual([{ type: 'pockets/cancel', visitId: id }]);
    expect(b.to(2, 'pockets/unmark')).toHaveLength(1);
  });
});

describe('Visits: pause, resume and the away take (release B)', () => {
  const switchAway = async () => {
    b.tabs.get(1)!.active = false;
    b.tabs.get(3)!.active = true;
    await v.onTabActivated(3);
  };
  const switchBack = async () => {
    b.tabs.get(3)!.active = false;
    b.tabs.get(1)!.active = true;
    await v.onTabActivated(1);
  };
  /** The user leaves the browser (another app in front); the absence is confirmed and the warning goes out. */
  const leaveBrowser = async () => {
    b.focused = false;
    await v.onFocusChanged();
    now += AWAY_CONFIRM_MS;
    await runTimers();
  };
  const awayId = (id: string) => 'pockets-away:' + id;

  describe('A: a tab switch inside the browser', () => {
    it('pauses; coming back restarts the full countdown under a new visit id, and a take needs a new card-shown', async () => {
      await store.saveSettings({ ...DEFAULT_SETTINGS, countdownSeconds: 7 });
      const id = await startShown();
      await v.onEvent(1, id, { type: 'tick', remaining: 7 });
      await v.onEvent(1, id, { type: 'tick', remaining: 6 });
      await switchAway();
      expect((await rt()).visit!.pause).toBeDefined();
      // Events from the hidden stage are ignored while paused.
      await v.onEvent(1, id, { type: 'tick', remaining: 5 });
      await v.onEvent(1, id, { type: 'take' });
      expect(b.removed).toEqual([]);
      now += 30_000;
      await switchBack();
      const plans = b.plans(1);
      expect(plans).toHaveLength(2);
      const resumed = plans[1];
      expect(resumed.visitId).not.toBe(id);
      expect(resumed).toMatchObject({ targetTabId: 2, title: 'Old page', countdownSeconds: 7, resume: true, targetIsStage: false });
      const r = await rt();
      expect(r.visit).toMatchObject({ visitId: resumed.visitId, cardShown: false, targetTabId: 2, stageTabId: 1 });
      expect(r.visit!.pause).toBeUndefined();
      expect(b.alarms.has(DEADLINE_ALARM)).toBe(false);
      // A late card-shown or take from the old play does not count.
      await v.onEvent(1, id, { type: 'card-shown' });
      expect((await rt()).visit!.cardShown).toBe(false);
      await v.onEvent(1, id, { type: 'take' });
      expect(b.removed).toEqual([]);
      // The new play's take without its own card-shown closes nothing.
      await v.onEvent(1, resumed.visitId, { type: 'take' });
      expect(b.removed).toEqual([]);
      expect((await rt()).visit).toBeNull();
    });

    it('after the resumed card is confirmed, the take closes the target', async () => {
      const id = await startShown();
      await switchAway();
      await switchBack();
      const nid = await visitId();
      expect(nid).not.toBe(id);
      await v.onEvent(1, nid, { type: 'card-shown' });
      await v.onEvent(1, nid, { type: 'take' });
      expect(b.removed).toEqual([2]);
      expect((await store.taken())[0]).toMatchObject({ url: 'https://old.com/page', noticeTabId: 1 });
      expect(b.created).toEqual([]);
    });

    it('not back within 5 minutes: the visit ends quietly, nothing removed, no notification', async () => {
      const id = await startShown();
      const pausedAt = now;
      await switchAway();
      expect(b.alarms.get(DEADLINE_ALARM)).toBe(pausedAt + GRACE_MS);
      now = pausedAt + GRACE_MS - 1;
      await v.onDeadline();
      await v.tick();
      expect((await rt()).visit?.visitId).toBe(id);
      now = pausedAt + GRACE_MS;
      await runTimers(); // the in-worker deadline timer
      expect((await rt()).visit).toBeNull();
      expect(b.removed).toEqual([]);
      expect(b.created).toEqual([]);
      expect(b.alarms.has(DEADLINE_ALARM)).toBe(false);
    });

    it('the minute tick ends a paused visit whose deadline passed, if the alarm never came', async () => {
      await startShown();
      await switchAway();
      now += GRACE_MS + 30_000;
      await v.tick();
      expect((await rt()).visit).toBeNull();
      expect(b.removed).toEqual([]);
    });

    it('the 60 s silence rule does not end a paused visit', async () => {
      const id = await startShown();
      await switchAway();
      now += 3 * 60_000;
      await v.tick();
      expect((await rt()).visit?.visitId).toBe(id);
      expect(b.to(1, 'pockets/cancel')).toHaveLength(1); // only the pause's
    });
  });

  describe('B: leaving the browser', () => {
    it('one warning notification for the visit, with the target title; repeated focus events add none', async () => {
      const id = await startShown();
      await leaveBrowser();
      expect(b.created).toEqual([{ id: awayId(id), title: 'Pockets has his eye on “Old page”', message: AWAY_MESSAGE }]);
      const p = (await rt()).visit!.pause!;
      expect(p).toMatchObject({ notifyTried: true, notifiedAt: now, notificationId: awayId(id) });
      expect(b.alarms.get(DEADLINE_ALARM)).toBe(now + GRACE_MS);
      await v.onFocusChanged();
      await v.tick();
      now += AWAY_CONFIRM_MS;
      await runTimers();
      expect(b.created).toHaveLength(1);
      expect(b.removed).toEqual([]);
    });

    it('a minimised stage window counts as away', async () => {
      const id = await startShown();
      b.minimized.add(1);
      b.anyFocused = true;
      b.focused = false; // the minimised window is no longer the focused one
      await v.onFocusChanged();
      now += AWAY_CONFIRM_MS;
      await runTimers();
      expect(b.created.map((c) => c.id)).toEqual([awayId(id)]);
    });

    it('a no-window-focused blip during a switch between two browser windows sends no notification', async () => {
      await startShown();
      b.focused = false;
      b.anyFocused = false;
      await v.onFocusChanged();
      b.anyFocused = true; // another browser window took focus a moment later
      await v.onFocusChanged();
      now += AWAY_CONFIRM_MS;
      await runTimers();
      expect(b.created).toEqual([]);
      expect((await rt()).visit!.pause).toBeDefined();
    });

    it('5 minutes after the notification, still away: the target is taken without the card, recorded, and Undo is offered', async () => {
      await store.saveRuntime({ ...(await rt()), staleTakes: [T0 - 2 * HOUR] });
      const id = await startShown();
      await leaveBrowser();
      const notifiedAt = now;
      now = notifiedAt + GRACE_MS - 1;
      await v.onDeadline();
      expect(b.removed).toEqual([]);
      now = notifiedAt + GRACE_MS;
      await v.onDeadline();
      expect(b.removed).toEqual([2]);
      const taken = await store.taken();
      expect(taken).toEqual([{ title: 'Old page', url: 'https://old.com/page', favIconUrl: 'https://old.com/f.ico', takenAt: now,
        reason: 'stale', sessionId: 'sess-1' }]);
      const r = await rt();
      expect(r.visit).toBeNull();
      expect(r.staleTakes).toEqual([now]);
      expect(r.lastStaleVisitEnd).toBe(now);
      expect(b.cleared).toContain(awayId(id));
      expect(b.created.at(-1)).toEqual({ id: 'pockets-taken:' + now, title: 'Pockets stole “Old page”', message: TAKEN_MESSAGE, buttons: ['Undo'] });
      expect(b.to(1, 'pockets/notice')).toEqual([]);
      expect(b.badges.at(-1)).toBe('');
    });

    it('a distracting away take records lastDistractingTake', async () => {
      await store.saveRuntime({ ...(await rt()), working: true, workingSince: T0 - HOUR });
      b.add({ id: 4, url: 'https://www.youtube.com/watch?v=x', title: 'Video', lastAccessed: T0 - 60_000 });
      await startShown();
      await leaveBrowser();
      now += GRACE_MS;
      await v.onDeadline();
      expect(b.removed).toEqual([4]);
      expect((await rt()).lastDistractingTake).toBe(now);
      expect(b.badges.at(-1)).toBe(' '); // the working dot is back
    });

    it('Undo on the "stole" notification restores the tab in place', async () => {
      await startShown();
      await leaveBrowser();
      now += GRACE_MS;
      await v.onDeadline();
      const takenAt = (await store.taken())[0].takenAt;
      await v.onNotificationButton('pockets-taken:' + takenAt, 0);
      expect(b.restored).toEqual(['sess-1']);
      expect(b.restoredUrls).toEqual(['https://old.com/page']);
      expect(await store.taken()).toEqual([]);
      expect(b.cleared).toContain('pockets-taken:' + takenAt);
    });

    it('Undo falls back to opening the URL when the session cannot be restored', async () => {
      b.restoreOk = false;
      await startShown();
      await leaveBrowser();
      now += GRACE_MS;
      await v.onDeadline();
      const takenAt = (await store.taken())[0].takenAt;
      await v.onNotificationButton('pockets-taken:' + takenAt, 0);
      expect(b.opened).toEqual(['https://old.com/page']);
    });

    it('at the deadline a browser window is focused but the stage is not in front: nothing removed, the visit ends', async () => {
      await startShown();
      await leaveBrowser();
      b.focused = true;
      b.tabs.get(1)!.active = false;
      b.tabs.get(3)!.active = true;
      now += GRACE_MS;
      await v.onDeadline();
      expect(b.removed).toEqual([]);
      expect((await rt()).visit).toBeNull();
    });

    it('the browser is focused again during the final checks: nothing removed', async () => {
      await startShown();
      await leaveBrowser();
      now += GRACE_MS;
      let n = 0;
      b.onGetTab = (tabId) => { if (tabId === 2 && ++n === 1) b.anyFocused = true; };
      await v.onDeadline();
      expect(n).toBeGreaterThanOrEqual(1);
      expect(b.removed).toEqual([]);
      expect(b.removeUrls).toEqual([]);
      expect(await store.taken()).toEqual([]);
    });

    it('the browser is focused while the take is being recorded (after the entry check): nothing removed, nothing recorded', async () => {
      const id = await startShown();
      await leaveBrowser();
      now += GRACE_MS;
      b.onClear = (cid) => { if (cid === awayId(id)) b.anyFocused = true; }; // end() withdraws the warning mid-take
      await v.onDeadline();
      expect(b.cleared).toContain(awayId(id));
      expect(b.removed).toEqual([]);
      expect(b.removeUrls).toEqual([]);
      expect(await store.taken()).toEqual([]);
      expect(b.created.filter((c) => c.id.startsWith('pockets-taken:'))).toEqual([]);
    });

    it('back at the stage before the deadline: resumed, the warning withdrawn, and the alarm decides nothing', async () => {
      const id = await startShown();
      await leaveBrowser();
      now += 2 * 60_000;
      b.focused = true;
      await v.onFocusChanged();
      const r = await rt();
      expect(r.visit!.visitId).not.toBe(id);
      expect(r.visit!.pause).toBeUndefined();
      expect(b.cleared).toContain(awayId(id));
      expect(b.alarms.has(DEADLINE_ALARM)).toBe(false);
      expect(b.badges.at(-1)).toBe('');
      expect(b.plans(1).at(-1)).toMatchObject({ resume: true, countdownSeconds: 5 });
      now += 10 * 60_000;
      await v.onDeadline();
      await runTimers();
      expect(b.removed).toEqual([]);
    });

    it('leaving again after a resume warns again with a fresh 5 minutes (each away period has its own warning)', async () => {
      const id = await startShown();
      await leaveBrowser();
      b.focused = true;
      await v.onFocusChanged();
      const nid = await visitId();
      await v.onEvent(1, nid, { type: 'card-shown' });
      await leaveBrowser();
      expect(b.created.map((c) => c.id)).toEqual([awayId(id), awayId(nid)]);
      const second = now;
      now = second + GRACE_MS - 1;
      await v.onDeadline();
      expect(b.removed).toEqual([]);
      now = second + GRACE_MS;
      await v.onDeadline();
      expect(b.removed).toEqual([2]);
    });

    it('back in the browser on another tab, then away again: no second warning; the first deadline still decides', async () => {
      await startShown();
      await leaveBrowser();
      const notifiedAt = now;
      b.focused = true;
      b.tabs.get(1)!.active = false;
      b.tabs.get(3)!.active = true;
      await v.onTabActivated(3);
      b.focused = false;
      now += 60_000;
      await v.onFocusChanged();
      now += AWAY_CONFIRM_MS;
      await runTimers();
      expect(b.created).toHaveLength(1);
      now = notifiedAt + GRACE_MS;
      await v.onDeadline();
      expect(b.removed).toEqual([2]);
    });

    it('the notification cannot be created: never an away take; the visit ends quietly 5 min after leaving', async () => {
      b.notifyFails = true;
      const id = await startShown();
      const leftAt = now;
      await leaveBrowser();
      const p = (await rt()).visit!.pause!;
      expect(p.notifyTried).toBe(true);
      expect(p.notifiedAt).toBeUndefined();
      expect(p.notificationId).toBeUndefined();
      now = leftAt + GRACE_MS;
      await v.onDeadline();
      expect(b.removed).toEqual([]);
      expect((await rt()).visit).toBeNull();
      expect(id).toBeTruthy();
    });

    it('clicking the warning focuses the stage, and that pause can no longer take while away', async () => {
      const id = await startShown();
      await leaveBrowser();
      await v.onNotificationClicked(awayId(id));
      expect(b.focusedTabs).toEqual([1]);
      expect((await rt()).visit!.pause!.clickedAt).toBe(now);
      now += GRACE_MS; // the focus never arrived (say the OS refused it)
      await v.onDeadline();
      expect(b.removed).toEqual([]);
      expect((await rt()).visit).toBeNull();
    });

    it('a click on a warning for another visit does nothing to this one', async () => {
      const id = await startShown();
      await leaveBrowser();
      await v.onNotificationClicked('pockets-away:someone-else');
      expect(b.focusedTabs).toEqual([]);
      now += GRACE_MS;
      await v.onDeadline();
      expect(b.removed).toEqual([2]);
      expect(id).toBeTruthy();
    });

    it('target typed into, pinned, or navigated by the deadline: nothing removed', async () => {
      for (const spoil of ['typed', 'pinned', 'url'] as const) {
        b = new FakeBrowser();
        store = new Store(mapKV());
        now = T0;
        timers = [];
        b.add({ id: 1, url: 'https://work.com/doc', title: 'Work', active: true, lastAccessed: T0 });
        b.add({ id: 2, url: 'https://old.com/page', title: 'Old page', lastAccessed: T0 - 2 * DAY });
        b.add({ id: 3, url: 'https://fresh.com/', title: 'Fresh', lastAccessed: T0 - HOUR });
        make();
        await startShown();
        await leaveBrowser();
        if (spoil === 'typed') await v.updateRuntime((r) => ({ ...r, typedIn: [2] }));
        if (spoil === 'pinned') b.tabs.get(2)!.pinned = true;
        if (spoil === 'url') b.tabs.get(2)!.url = 'https://old.com/elsewhere'; // without an onUpdated event
        now += GRACE_MS;
        await v.onDeadline();
        expect(b.removed, spoil).toEqual([]);
        expect(await store.taken(), spoil).toEqual([]);
        expect((await rt()).visit, spoil).toBeNull();
      }
    });

    it('the only tab left in its window is not taken at the deadline', async () => {
      // A distracting page in front is both stage and target; while the user is away, its window's other tabs close.
      await store.saveRuntime({ ...(await rt()), working: true, workingSince: T0 - HOUR });
      b.tabs.get(1)!.active = false;
      b.add({ id: 4, url: 'https://www.youtube.com/watch?v=x', title: 'Video', active: true, lastAccessed: T0 });
      await v.tick();
      const id = await visitId();
      expect((await rt()).visit).toMatchObject({ targetTabId: 4, stageTabId: 4 });
      await v.onEvent(4, id, { type: 'card-shown' });
      await leaveBrowser();
      expect(b.created.map((c) => c.id)).toEqual([awayId(id)]);
      for (const t of [1, 2, 3]) { b.tabs.delete(t); await v.onTabGone(t); }
      expect((await rt()).visit?.visitId).toBe(id);
      now += GRACE_MS;
      await v.onDeadline();
      expect(b.removed).toEqual([]);
      expect(await store.taken()).toEqual([]);
      expect((await rt()).visit).toBeNull();
    });

    it('control: the same stage-target away visit with other tabs left is taken', async () => {
      await store.saveRuntime({ ...(await rt()), working: true, workingSince: T0 - HOUR });
      b.tabs.get(1)!.active = false;
      b.add({ id: 4, url: 'https://www.youtube.com/watch?v=x', title: 'Video', active: true, lastAccessed: T0 });
      await v.tick();
      const id = await visitId();
      await v.onEvent(4, id, { type: 'card-shown' });
      await leaveBrowser();
      now += GRACE_MS;
      await v.onDeadline();
      expect(b.removed).toEqual([4]);
    });
  });

  describe('worker and browser restarts', () => {
    it('a worker restart during an away pause keeps the visit, re-arms the deadline, and the deadline still decides', async () => {
      const id = await startShown();
      await leaveBrowser();
      const notifiedAt = now;
      b.alarms.clear();
      make(); // a fresh worker: no memo, no timers
      timers = [];
      await v.onWake();
      expect((await rt()).visit?.visitId).toBe(id);
      expect(b.alarms.get(DEADLINE_ALARM)).toBe(notifiedAt + GRACE_MS);
      expect(b.to(2, 'pockets/unmark')).toHaveLength(1); // only the pause's
      now = notifiedAt + GRACE_MS;
      make(); // and another restart before the alarm
      await v.onWake();
      expect(b.removed).toEqual([2]);
      expect((await store.taken())[0]).toMatchObject({ title: 'Old page', url: 'https://old.com/page' });
      expect(b.created.at(-1)!.title).toBe('Pockets stole “Old page”');
    });

    it('a worker restart during a tab-switch pause, then the user comes back: resumed', async () => {
      const id = await startShown();
      await switchAwayHelper();
      make();
      await v.onWake();
      expect((await rt()).visit?.visitId).toBe(id);
      b.tabs.get(3)!.active = false;
      b.tabs.get(1)!.active = true;
      await v.onTabActivated(1);
      expect(b.plans(1).at(-1)).toMatchObject({ resume: true, title: 'Old page', faviconUrl: 'https://old.com/f.ico' });
    });

    it('a browser restart (new boot id) abandons a paused visit: nothing removed', async () => {
      const id = await startShown();
      await leaveBrowser();
      b.boot = 'boot-2';
      make();
      now += GRACE_MS;
      await v.onWake();
      expect((await rt()).visit).toBeNull();
      expect(b.removed).toEqual([]);
      expect(b.cleared).toContain(awayId(id));
    });
  });

  describe('other events during a pause', () => {
    it('working mode switched off during a paused distracting visit abandons it and withdraws the warning', async () => {
      await store.saveRuntime({ ...(await rt()), working: true, workingSince: T0 - HOUR });
      b.add({ id: 4, url: 'https://www.youtube.com/watch?v=x', title: 'Video', lastAccessed: T0 - 60_000 });
      const id = await startShown();
      await leaveBrowser();
      await store.saveRuntime({ ...(await rt()), working: false });
      await v.onWorkingOff();
      expect((await rt()).visit).toBeNull();
      expect(b.cleared).toContain(awayId(id));
      expect(b.alarms.has(DEADLINE_ALARM)).toBe(false);
      now += GRACE_MS;
      await v.onDeadline();
      expect(b.removed).toEqual([]);
      expect(b.badges.at(-1)).toBe('');
    });

    it('activating a paused stale target is Keep', async () => {
      const id = await startShown();
      await switchAwayHelper();
      b.tabs.get(3)!.active = false;
      b.tabs.get(2)!.active = true;
      await v.onTabActivated(2);
      const r = await rt();
      expect(r.visit).toBeNull();
      expect(r.spared[2]).toBeDefined();
      expect(b.removed).toEqual([]);
      expect(id).toBeTruthy();
    });

    it('activating a paused distracting target replays with it as the stage and the full countdown', async () => {
      await store.saveRuntime({ ...(await rt()), working: true, workingSince: T0 - HOUR });
      b.add({ id: 4, url: 'https://www.youtube.com/watch?v=x', title: 'Video', lastAccessed: T0 - 60_000 });
      const id = await startShown();
      await v.onEvent(1, id, { type: 'tick', remaining: 2 });
      await leaveBrowser();
      b.focused = true;
      b.tabs.get(1)!.active = false;
      b.tabs.get(4)!.active = true;
      await v.onTabActivated(4);
      const r = await rt();
      expect(r.visit).toMatchObject({ stageTabId: 4, targetTabId: 4 });
      expect(r.visit!.pause).toBeUndefined();
      expect(b.plans(4).at(-1)).toMatchObject({ countdownSeconds: 5, targetIsStage: true });
      expect(b.cleared).toContain(awayId(id));
    });

    it('the target closing during a pause abandons the visit', async () => {
      await startShown();
      await leaveBrowser();
      b.tabs.delete(2);
      await v.onTabGone(2);
      expect((await rt()).visit).toBeNull();
      now += GRACE_MS;
      await v.onDeadline();
      expect(b.removed).toEqual([]);
    });

    it('a hidden event while the stage is not in front pauses instead of abandoning', async () => {
      const id = await startShown();
      b.tabs.get(1)!.active = false;
      b.tabs.get(3)!.active = true;
      await v.onEvent(1, id, { type: 'hidden' });
      expect((await rt()).visit?.pause).toBeDefined();
    });

    it('a stage-target take pending when the user switches away is dropped; the pause holds', async () => {
      await store.saveRuntime({ ...(await rt()), working: true, workingSince: T0 - HOUR });
      b.tabs.get(1)!.active = false;
      b.add({ id: 4, url: 'https://www.youtube.com/watch?v=x', title: 'Video', active: true, lastAccessed: T0 });
      await v.tick();
      const id = await visitId();
      await v.onEvent(4, id, { type: 'card-shown' });
      await v.onEvent(4, id, { type: 'take' });
      b.tabs.get(4)!.active = false;
      b.tabs.get(3)!.active = true;
      await v.onTabActivated(3);
      for (const t of timers.splice(0)) t.fn(); // the 800 ms take timer, and the deadline timer (early)
      await v.idle();
      await v.onEvent(4, id, { type: 'done' });
      expect(b.removed).toEqual([]);
      expect((await rt()).visit?.pause).toBeDefined();
    });
  });

  describe('badge', () => {
    it('"!" while paused, cleared on resume; the working dot is kept before and restored after', async () => {
      await v.updateRuntime((r) => ({ ...r, working: true, workingSince: T0 }));
      expect(b.badges.at(-1)).toBe(' ');
      await startShown();
      await switchAwayHelper();
      expect(b.badges.at(-1)).toBe('!');
      b.tabs.get(3)!.active = false;
      b.tabs.get(1)!.active = true;
      await v.onTabActivated(1);
      expect(b.badges.at(-1)).toBe(' ');
      await v.updateRuntime((r) => ({ ...r, working: false }));
      expect(b.badges.at(-1)).toBe('');
    });

    it('cleared when a paused visit ends quietly', async () => {
      await startShown();
      await switchAwayHelper();
      expect(b.badges.at(-1)).toBe('!');
      now += GRACE_MS;
      await v.onDeadline();
      expect(b.badges.at(-1)).toBe('');
    });
  });

  describe('the away-take guard', () => {
    type Guard = { takeAllowed(v: ActiveVisit, path: 'card' | 'away'): Promise<boolean> };
    const guard = () => v as unknown as Guard;
    const paused = (over: Partial<NonNullable<ActiveVisit['pause']>> = {}): ActiveVisit => ({
      visitId: 'v9', targetTabId: 2, targetUrl: 'https://old.com/page', stageTabId: 1, reason: 'stale', cardShown: false, startedAt: T0,
      pause: { at: T0 - GRACE_MS - 10, bootId: 'boot-1', windowId: 1, notifyTried: true, notifiedAt: T0 - GRACE_MS,
        notificationId: 'pockets-away:v9', plan: { visitId: 'v9', targetTabId: 2, title: 'Old page', reason: 'stale',
          reasonText: 'x', tabIndex: 1, tabCount: 3, countdownSeconds: 5, targetIsStage: false }, ...over },
    });
    beforeEach(() => { b.focused = false; });

    it('allows only a notification at least the grace period old, for this visit, unclicked, this boot, browser unfocused', async () => {
      expect(await guard().takeAllowed(paused(), 'away')).toBe(true);
      expect(await guard().takeAllowed(paused({ notifiedAt: T0 - GRACE_MS + 1 }), 'away')).toBe(false);
      expect(await guard().takeAllowed(paused({ notifiedAt: undefined }), 'away')).toBe(false);
      expect(await guard().takeAllowed(paused({ notificationId: undefined }), 'away')).toBe(false);
      expect(await guard().takeAllowed(paused({ notificationId: 'pockets-away:other' }), 'away')).toBe(false);
      expect(await guard().takeAllowed(paused({ clickedAt: T0 - 1 }), 'away')).toBe(false);
      expect(await guard().takeAllowed(paused({ bootId: 'boot-0' }), 'away')).toBe(false);
      b.anyFocused = true;
      expect(await guard().takeAllowed(paused(), 'away')).toBe(false);
    });

    it('the card path never applies to a paused visit, even with cardShown', async () => {
      expect(await guard().takeAllowed({ ...paused(), cardShown: true }, 'card')).toBe(false);
      const { pause: _p, ...running } = paused();
      expect(await guard().takeAllowed({ ...running, cardShown: true }, 'card')).toBe(true);
      expect(await guard().takeAllowed({ ...running, cardShown: false }, 'card')).toBe(false);
    });
  });

  async function switchAwayHelper() {
    b.tabs.get(1)!.active = false;
    b.tabs.get(3)!.active = true;
    await v.onTabActivated(3);
  }
});
