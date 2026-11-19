// The visit state machine. The only code that closes tabs.
//
// Safety rules enforced here (see the design's "A visit" and the plan's Global Constraints):
//   - A tab is closed only after the visit's own stage reported `card-shown` (persisted as rt.visit.cardShown).
//   - At take, the target is re-read: gone, a different URL, another window, pinned or typed into means close nothing.
//   - Only rt.visit.targetTabId is ever passed to removeTab.
//   - One visit at a time; only tabs in the focused window are candidates.
//   - A stored visit found on wake, or one silent for 60 s, is cancelled and unmarked; nothing is closed.
// Every public method runs read-decide-write inside one promise queue, so events cannot interleave.
import type { ActiveVisit, RuntimeState, TabInfo, ToContent, VisitEvent, VisitPlan } from '../shared/types';
import { pickTarget } from '../rules/target';
import { canVisit } from '../rules/pacing';
import { spareKept, type Store } from './store';

/** Thin wrapper over chrome.*, faked in tests. Implementations never throw. */
export interface Browser {
  tabsInFocusedWindow(): Promise<{ windowId: number; tabs: TabInfo[] } | null>;
  getTab(id: number): Promise<TabInfo | null>;
  removeTab(id: number): Promise<void>;
  /** False if the tab cannot receive (no content script, asleep, or it answered `{ ok: false }`). */
  send(tabId: number, msg: ToContent): Promise<boolean>;
  userActive(): Promise<boolean>;
  /** The session id of the most recently closed tab, optionally only if it has this URL. */
  lastClosedSessionId(url?: string): Promise<string | undefined>;
  restore(sessionId: string): Promise<boolean>;
  openUrl(url: string): Promise<void>;
}

export type Schedule = (fn: () => void, ms: number) => void;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
export const ABANDON_MS = 60_000;
export const STAGE_TAKE_MS = 800;

/** Presentation and bookkeeping for the current visit. Lost with the worker, which is fine: on wake the visit is abandoned. */
interface Memo {
  visitId: string;
  title: string;
  favIconUrl?: string;
  windowId: number;
  plan: VisitPlan;
  lastEventAt: number;
  remaining?: number;
  takePending: boolean;
}

export function reasonText(reason: 'stale' | 'distracting', lastAccessed: number, now: number): string {
  if (reason === 'distracting') return 'distracting';
  const age = Math.max(0, now - lastAccessed);
  if (age >= DAY) {
    const d = Math.floor(age / DAY);
    return `not opened for ${d} ${d === 1 ? 'day' : 'days'}`;
  }
  const h = Math.max(1, Math.floor(age / HOUR));
  return `not opened for ${h} ${h === 1 ? 'hour' : 'hours'}`;
}

export class Visits {
  private queue: Promise<void> = Promise.resolve();
  private memo: Memo | null = null;

  constructor(
    private browser: Browser,
    private store: Store,
    private now: () => number,
    private newId: () => string,
    private schedule: Schedule = (fn, ms) => { setTimeout(fn, ms); },
  ) {}

  /** Run `fn` after everything queued before it. Errors are contained so one failure cannot wedge the queue. */
  private serial(fn: () => Promise<void>): Promise<void> {
    const next = this.queue.then(fn).catch((e) => { console.error('[pockets] visit error', e); });
    this.queue = next;
    return next;
  }

  /** Resolves once everything queued so far has run. */
  idle(): Promise<void> { return this.queue; }

  /** Change runtime state inside the queue (typed-in, forgetTab, ...). */
  updateRuntime(fn: (rt: RuntimeState) => RuntimeState): Promise<void> {
    return this.serial(async () => { await this.store.saveRuntime(fn(await this.store.runtime())); });
  }

  tick(): Promise<void> { return this.serial(() => this.doTick()); }
  onEvent(tabId: number, visitId: string, e: VisitEvent): Promise<void> { return this.serial(() => this.doEvent(tabId, visitId, e)); }
  onTabGone(tabId: number): Promise<void> { return this.serial(() => this.doTabLost(tabId)); }
  onTabChanged(tabId: number): Promise<void> { return this.serial(() => this.doTabLost(tabId)); }
  onTabActivated(tabId: number): Promise<void> { return this.serial(() => this.doActivated(tabId)); }
  onWake(): Promise<void> {
    return this.serial(async () => {
      const rt = await this.store.runtime();
      if (rt.visit) await this.abandon(rt, rt.visit);
    });
  }
  undo(takenAt: number): Promise<void> { return this.serial(() => this.doUndo(takenAt)); }

  // ---- internals (always called inside the queue) ----

  private memoFor(v: ActiveVisit): Memo | null { return this.memo && this.memo.visitId === v.visitId ? this.memo : null; }

  /** Clear the visit and save. Any started stale visit counts for the gap between visits. */
  private async end(rt: RuntimeState, v: ActiveVisit, extra: Partial<RuntimeState> = {}): Promise<RuntimeState> {
    const next: RuntimeState = { ...rt, ...extra, visit: null };
    if (v.reason === 'stale') next.lastStaleVisitEnd = this.now();
    this.memo = null;
    await this.store.saveRuntime(next);
    return next;
  }

  /** Cancel on the stage and unmark the target, best-effort. Closes nothing. */
  private async abandon(rt: RuntimeState, v: ActiveVisit): Promise<void> {
    await this.end(rt, v);
    await this.browser.send(v.targetTabId, { type: 'pockets/unmark' });
    await this.browser.send(v.stageTabId, { type: 'pockets/cancel', visitId: v.visitId });
  }

  private async doTick(): Promise<void> {
    const rt = await this.store.runtime();
    const now = this.now();
    if (rt.visit) {
      const last = this.memoFor(rt.visit)?.lastEventAt ?? rt.visit.startedAt;
      if (!(now - last < ABANDON_MS)) await this.abandon(rt, rt.visit);
      return;
    }
    const win = await this.browser.tabsInFocusedWindow();
    if (!win) return;
    const userActive = await this.browser.userActive();
    const s = await this.store.settings();
    const pick = pickTarget(win.tabs, win.windowId, s, rt, now);
    if (!pick || !pick.tab.url) return;
    if (!canVisit(pick.reason, s, rt, { now, userActive, windowFocused: true })) return;
    const stage = win.tabs.find((t) => t.active && t.windowId === win.windowId);
    if (!stage) return;
    const tabCount = win.tabs.filter((t) => t.windowId === pick.tab.windowId).length;
    await this.start(rt, pick.tab, pick.reason, stage.id, tabCount, s.countdownSeconds);
  }

  /** Persist the visit, then ask the stage to play. If it cannot, the visit never started. */
  private async start(rt: RuntimeState, target: TabInfo, reason: 'stale' | 'distracting', stageTabId: number,
                      tabCount: number, countdownSeconds: number, title = target.title, favIconUrl = target.favIconUrl): Promise<boolean> {
    const now = this.now();
    const visit: ActiveVisit = { visitId: this.newId(), targetTabId: target.id, targetUrl: target.url, stageTabId, reason,
      cardShown: false, startedAt: now };
    const plan: VisitPlan = { visitId: visit.visitId, targetTabId: target.id, title, faviconUrl: favIconUrl, reason,
      reasonText: reasonText(reason, target.lastAccessed, now), tabIndex: target.index, tabCount,
      countdownSeconds: Math.max(1, Math.round(countdownSeconds)), targetIsStage: stageTabId === target.id };
    if (plan.faviconUrl === undefined) delete plan.faviconUrl;
    await this.store.saveRuntime({ ...rt, visit });
    this.memo = { visitId: visit.visitId, title, favIconUrl, windowId: target.windowId, plan, lastEventAt: now, takePending: false };
    const ok = await this.browser.send(stageTabId, { type: 'pockets/play', plan });
    if (!ok) {
      // Re-read: nothing else can run meanwhile (queue), but keep the write minimal.
      const cur = await this.store.runtime();
      if (cur.visit?.visitId === visit.visitId) await this.store.saveRuntime({ ...cur, visit: null });
      this.memo = null;
      return false;
    }
    return true;
  }

  private async doEvent(tabId: number, visitId: string, e: VisitEvent): Promise<void> {
    const rt = await this.store.runtime();
    const v = rt.visit;
    if (!v || v.visitId !== visitId || tabId !== v.stageTabId) return;
    const memo = this.memoFor(v);
    if (memo) memo.lastEventAt = this.now();

    switch (e.type) {
      case 'card-shown':
        if (v.cardShown !== true) await this.store.saveRuntime({ ...rt, visit: { ...v, cardShown: true } });
        return;
      case 'tick':
        if (memo) memo.remaining = e.remaining;
        await this.browser.send(v.targetTabId, { type: 'pockets/mark', remaining: e.remaining }); // failure is not fatal
        return;
      case 'keep': {
        const s = await this.store.settings();
        await this.end(spareKept(rt, v.targetTabId, v.reason, s, this.now()), v);
        await this.browser.send(v.targetTabId, { type: 'pockets/unmark' });
        return;
      }
      case 'take': {
        if (v.cardShown !== true) { await this.abandon(rt, v); return; }
        if (!(await this.targetStillValid(rt, v))) { await this.abandon(rt, v); return; }
        if (v.targetTabId !== v.stageTabId) { await this.finishTake(rt, v); return; }
        // The target is the stage: let the grab play, then close on `done` or after 800 ms, whichever is first.
        if (!memo) { await this.abandon(rt, v); return; } // state we cannot account for: close nothing
        if (memo.takePending) return;
        memo.takePending = true;
        this.schedule(() => { void this.serial(() => this.completeStageTake(visitId)); }, STAGE_TAKE_MS);
        return;
      }
      case 'done':
        if (memo?.takePending) await this.completeStageTake(visitId);
        return;
      default:
        return;
    }
  }

  private async completeStageTake(visitId: string): Promise<void> {
    const rt = await this.store.runtime();
    const v = rt.visit;
    if (!v || v.visitId !== visitId || !this.memoFor(v)?.takePending) return;
    if (v.cardShown !== true || !(await this.targetStillValid(rt, v))) { await this.abandon(rt, v); return; }
    await this.finishTake(rt, v);
  }

  /** Re-read the target: it must still exist with the same URL, in the same window, unpinned, and not typed into. */
  private async targetStillValid(rt: RuntimeState, v: ActiveVisit): Promise<boolean> {
    if (rt.typedIn.includes(v.targetTabId)) return false; // typed into during the visit: closing would lose work
    const t = await this.browser.getTab(v.targetTabId);
    if (!t || t.id !== v.targetTabId || t.url !== v.targetUrl || t.pinned) return false;
    const memo = this.memoFor(v);
    if (memo && t.windowId !== memo.windowId) return false;
    return true;
  }

  /** Close exactly v.targetTabId. Callers have checked cardShown and re-read the target. */
  private async finishTake(rt: RuntimeState, v: ActiveVisit): Promise<void> {
    if (v.cardShown !== true) return; // belt and braces: never close without the card
    const memo = this.memoFor(v);
    const target = await this.browser.getTab(v.targetTabId);
    const title = memo?.title ?? target?.title ?? v.targetUrl;
    const favIconUrl = memo ? memo.favIconUrl : target?.favIconUrl;
    const takenAt = this.now();
    const after = await this.end(rt, v);
    // Record first, so a worker death between close and record cannot lose a closed tab.
    const entry = { title, url: v.targetUrl, takenAt, reason: v.reason, ...(favIconUrl ? { favIconUrl } : {}) };
    await this.store.addTaken(entry);
    try {
      await this.browser.removeTab(v.targetTabId);
    } catch {
      await this.store.removeTaken(takenAt);
      return;
    }
    const sessionId = await this.browser.lastClosedSessionId(v.targetUrl);
    if (sessionId) {
      await this.store.removeTaken(takenAt);
      await this.store.addTaken({ ...entry, sessionId });
    }
    const bookkeeping: Partial<RuntimeState> = v.reason === 'stale'
      ? { staleTakes: [...after.staleTakes.filter((t) => takenAt - t < HOUR), takenAt], lastStaleVisitEnd: takenAt }
      : { lastDistractingTake: takenAt, staleTakes: after.staleTakes.filter((t) => takenAt - t < HOUR) };
    await this.store.saveRuntime({ ...(await this.store.runtime()), ...bookkeeping });

    const notice: ToContent = { type: 'pockets/notice', title, takenAt };
    if (v.stageTabId !== v.targetTabId) {
      await this.browser.send(v.stageTabId, notice);
    } else {
      const win = await this.browser.tabsInFocusedWindow();
      const active = win?.tabs.find((t) => t.active && t.id !== v.targetTabId);
      if (active) await this.browser.send(active.id, notice);
    }
  }

  /** The target or the stage closed or navigated: abandon, close nothing. */
  private async doTabLost(tabId: number): Promise<void> {
    const rt = await this.store.runtime();
    const v = rt.visit;
    if (!v || (tabId !== v.targetTabId && tabId !== v.stageTabId)) return;
    await this.abandon(rt, v);
  }

  private async doActivated(tabId: number): Promise<void> {
    const rt = await this.store.runtime();
    const v = rt.visit;
    if (!v || tabId !== v.targetTabId || v.targetTabId === v.stageTabId) return;
    if (v.reason === 'stale') {
      // Treated as Keep, without the grumpy card text.
      const s = await this.store.settings();
      await this.end(spareKept(rt, v.targetTabId, 'stale', s, this.now()), v);
      await this.browser.send(v.targetTabId, { type: 'pockets/unmark' });
      await this.browser.send(v.stageTabId, { type: 'pockets/cancel', visitId: v.visitId });
      return;
    }
    // Distracting: not saved. Replay with the target as the stage and the time remaining.
    const memo = this.memoFor(v);
    await this.browser.send(v.stageTabId, { type: 'pockets/cancel', visitId: v.visitId });
    const target = await this.browser.getTab(v.targetTabId);
    if (!target || target.url !== v.targetUrl) { await this.abandon(rt, v); return; }
    const s = await this.store.settings();
    const remaining = memo?.remaining ?? s.countdownSeconds;
    const tabCount = memo?.plan.tabCount ?? target.index + 1;
    const started = await this.start({ ...rt, visit: null }, target, 'distracting', target.id, tabCount, remaining,
      memo?.title ?? target.title, memo ? memo.favIconUrl : target.favIconUrl);
    if (!started) {
      await this.browser.send(v.targetTabId, { type: 'pockets/unmark' });
      await this.end(await this.store.runtime(), v);
    }
  }

  private async doUndo(takenAt: number): Promise<void> {
    const entry = (await this.store.taken()).find((t) => t.takenAt === takenAt);
    if (!entry) return;
    const restored = entry.sessionId ? await this.browser.restore(entry.sessionId) : false;
    if (!restored) await this.browser.openUrl(entry.url);
    await this.store.removeTaken(takenAt);
  }
}
