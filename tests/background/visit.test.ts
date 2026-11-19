import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Visits, type Browser } from '../../src/background/visit';
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
      reason: 'stale', sessionId: 'sess-1' }]);
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

  describe('switching away from the stage mid-countdown', () => {
    async function expectCancelledWithoutSpare(id: string) {
      expect(b.removed).toEqual([]);
      const r = await rt();
      expect(r.visit).toBeNull();
      expect(r.spared).toEqual({});
      expect(r.lastStaleVisitEnd).toBe(now); // a stale visit still starts the gap
      expect(b.to(1, 'pockets/cancel')).toEqual([{ type: 'pockets/cancel', visitId: id }]);
      expect(b.to(2, 'pockets/unmark')).toHaveLength(1);
      await v.onEvent(1, id, { type: 'take' });
      expect(b.removed).toEqual([]);
    }

    it('stage deactivated after card-shown: nothing removed', async () => {
      const id = await startShown();
      b.tabs.get(1)!.active = false;
      b.tabs.get(3)!.active = true;
      await v.onTabActivated(3);
      await expectCancelledWithoutSpare(id);
    });

    it('window blur after card-shown: nothing removed', async () => {
      const id = await startShown();
      b.focused = false;
      await v.onFocusChanged();
      await expectCancelledWithoutSpare(id);
    });

    it('stage not active when take arrives (no activation event delivered): nothing removed', async () => {
      const id = await startShown();
      b.tabs.get(1)!.active = false;
      b.tabs.get(3)!.active = true;
      await v.onEvent(1, id, { type: 'take' });
      await expectCancelledWithoutSpare(id);
    });

    it('window not focused when take arrives: nothing removed', async () => {
      const id = await startShown();
      b.focused = false;
      await v.onEvent(1, id, { type: 'take' });
      await expectCancelledWithoutSpare(id);
    });

    it('stage already hidden when card-shown arrives: the visit is abandoned', async () => {
      await v.tick();
      const id = await visitId();
      b.tabs.get(1)!.active = false;
      b.tabs.get(3)!.active = true;
      await v.onEvent(1, id, { type: 'card-shown' });
      expect((await rt()).visit).toBeNull();
      await v.onEvent(1, id, { type: 'take' });
      expect(b.removed).toEqual([]);
      // after the gap the next tick can try again
      b.tabs.get(3)!.active = false;
      b.tabs.get(1)!.active = true;
      now += 5 * 60_000;
      await v.tick();
      expect(b.to(1, 'pockets/play')).toHaveLength(2);
    });

    it('a stale visit cancelled by switching away starts the gap: no visit 1 min later, one 5 min later', async () => {
      await startShown();
      const cancelledAt = now;
      b.tabs.get(1)!.active = false;
      b.tabs.get(3)!.active = true;
      await v.onTabActivated(3);
      expect(b.removed).toEqual([]);
      expect((await rt()).spared).toEqual({});
      b.tabs.get(3)!.active = false;
      b.tabs.get(1)!.active = true;
      now = cancelledAt + 60_000;
      await v.tick();
      expect(b.to(1, 'pockets/play')).toHaveLength(1);
      expect((await rt()).visit).toBeNull();
      now = cancelledAt + 5 * 60_000;
      await v.tick();
      expect(b.to(1, 'pockets/play')).toHaveLength(2);
      expect((await rt()).visit).not.toBeNull();
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
