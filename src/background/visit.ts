// The visit state machine. The only code that closes tabs.
//
// Safety rules enforced here (see the design's "A visit" and "When the full show is not possible"):
//   - A tab is closed only on one of two paths (takeAllowed):
//       card: the visit's own stage reported `card-shown` (persisted as rt.visit.cardShown) for the current play, and the
//             stage is in front when the take arrives;
//       away: the user left the browser, a system notification about this exact visit and target was created at least
//             graceMs earlier (pause.notifiedAt, set only after creation succeeded), and no browser window is focused at
//             the moment of taking (checked on entry and again just before the final re-read).
//   - A stage that finds its card no longer on screen when the take is due reports `hidden` instead: abandoned (or paused,
//     when the stage is no longer in front).
//   - At take, the target is re-read: gone, a different URL, another window, pinned, typed into, or the only tab in its
//     window means close nothing. Before an away take, the target must also still pass pickTarget's per-tab rules
//     (stillEligible: never-take list, sound, spared, still stale or still distracting in working mode).
//   - Only rt.visit.targetTabId is ever passed to removeTab, with targetUrl; the adapter closes only if the URL still matches.
//   - One visit at a time; only tabs in the focused window are candidates.
//   - A running (not paused) visit found on wake, or one silent for 60 s, is cancelled and unmarked; nothing is closed.
//
// Pausing. "In front" means the stage is the active tab of a focused normal window. When the stage stops being in front
// during a visit, the visit pauses (rt.visit.pause, persisted, because the worker will not live through five minutes):
// the stage is told to cancel, the target is unmarked, the badge shows "!", and a deadline alarm is set.
//   - The stage comes back in front: resume. The visit is replayed under a new visit id (so nothing the old play sent can
//     count) with the full countdown, and a take again needs a fresh card-shown.
//   - The user left the browser (no window focused, or the stage's window minimised), confirmed AWAY_CONFIRM_MS later:
//     one warning notification per away period. Its deadline is notifiedAt + graceMs.
//   - At the deadline (pause.at + graceMs without a notification): still away with a notification -> away take, with a
//     second notification offering Undo. Otherwise the visit ends quietly.
// Every public method runs read-decide-write inside one promise queue, so events cannot interleave.
import type { ActiveVisit, RuntimeState, TabInfo, ToContent, VisitEvent, VisitPause, VisitPlan } from '../shared/types';
import { pickTarget, stillEligible } from '../rules/target';
import { canVisit } from '../rules/pacing';
import { spareKept, type Store } from './store';

/** Thin wrapper over chrome.*, faked in tests. Implementations never throw. */
export interface Browser {
  tabsInFocusedWindow(): Promise<{ windowId: number; tabs: TabInfo[] } | null>;
  getTab(id: number): Promise<TabInfo | null>;
  /** Close the tab only if, at the last moment, its URL is still `expectedUrl` (and it is unpinned). True if it was closed. */
  removeTab(id: number, expectedUrl: string): Promise<boolean>;
  /** False if the tab cannot receive (no content script, asleep, or it answered `{ ok: false }`). */
  send(tabId: number, msg: ToContent): Promise<boolean>;
  userActive(): Promise<boolean>;
  /** The session id of the most recently closed tab, optionally only if it has this URL. */
  lastClosedSessionId(url?: string): Promise<string | undefined>;
  /** Restore the closed tab, only if that session entry is a tab with this URL; false otherwise. */
  restore(sessionId: string, url: string): Promise<boolean>;
  openUrl(url: string): Promise<void>;
  /** True when any browser window has focus. When it cannot be told: true (a focused browser never allows an away take). */
  browserFocused(): Promise<boolean>;
  /** True when the window is minimised. False when unknown. */
  windowMinimized(windowId: number): Promise<boolean>;
  /** How many tabs the window holds; 0 when unknown. */
  tabCountInWindow(windowId: number): Promise<number>;
  /** Show a system notification. True only if it was created. */
  createNotification(id: string, n: { title: string; message: string; buttons?: string[] }): Promise<boolean>;
  clearNotification(id: string): Promise<void>;
  /** Focus the tab's window and make the tab active. */
  focusTab(tabId: number): Promise<void>;
  /** A one-shot alarm that wakes the worker at `when` (replaces one of the same name). */
  setAlarm(name: string, when: number): Promise<void>;
  clearAlarm(name: string): Promise<void>;
  setBadge(text: string, color: string): Promise<void>;
  /** An id for this run of the browser: it changes when the browser restarts (tab ids do not carry over). */
  bootId(): Promise<string>;
}

export type Schedule = (fn: () => void, ms: number) => void;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
export const ABANDON_MS = 60_000;
export const STAGE_TAKE_MS = 800;
/** How long a paused visit waits: for the user to come back, or after the away notification before taking. */
export const GRACE_MS = 5 * 60_000;
/** "No window focused" must still hold this long before the away notification fires: a plain switch between two
 *  browser windows can report no window focused for a moment. */
export const AWAY_CONFIRM_MS = 1500;
export const DEADLINE_ALARM = 'pockets-deadline';
export const AWAY_NOTIFICATION = 'pockets-away:';
export const TAKEN_NOTIFICATION = 'pockets-taken:';
export const AWAY_MESSAGE = "Come back within 5 minutes to keep this tab, otherwise he'll steal it.";
export const TAKEN_MESSAGE = 'He ran off with it. Undo brings it back.';
const BADGE_COLOR = '#d9483b';

/** Presentation and bookkeeping for the current visit. Lost with the worker, which is fine: on wake a running visit is
 *  abandoned, and a paused one keeps what it needs in rt.visit.pause. */
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

/** The tab is still the visit's target: same id and URL, unpinned, and (when known) in the same window. */
function tabMatches(t: TabInfo | null, v: ActiveVisit, windowId: number | undefined): boolean {
  if (!t || t.id !== v.targetTabId || t.url !== v.targetUrl || t.pinned) return false;
  return windowId === undefined || t.windowId === windowId;
}

type Front = 'front' | 'tab' | 'away' | 'gone';

export class Visits {
  private queue: Promise<void> = Promise.resolve();
  private memo: Memo | null = null;
  private badge: string | null = null;
  private confirmFor: string | null = null;
  private deadlineTimer: string | null = null;
  /** The pause grace period. Only a test build changes it (index.ts, inside `if (__POCKETS_TEST__)`). */
  graceMs = GRACE_MS;

  constructor(
    private browser: Browser,
    private store: Store,
    private now: () => number,
    private newId: () => string,
    private schedule: Schedule = (fn, ms) => { setTimeout(fn, ms); },
  ) {}

  /** Run `fn` after everything queued before it. Errors are contained so one failure cannot wedge the queue. */
  private serial(fn: () => Promise<void>): Promise<void> {
    const next = this.queue.then(fn).then(() => this.paintBadge()).catch((e) => { console.error('[pockets] visit error', e); });
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
  /** Worker start. A paused visit from this browser run is picked up again (resumed, kept waiting, or decided if its
   *  deadline passed); any other stored visit belonged to a dead worker and is abandoned. */
  onWake(): Promise<void> {
    return this.serial(async () => {
      const rt = await this.store.runtime();
      const v = rt.visit;
      if (!v) return;
      if (v.pause && v.pause.bootId === (await this.browser.bootId())) await this.reconcile(rt, v);
      else await this.abandon(rt, v);
    });
  }
  /** The deadline alarm (or its in-worker timer) fired. */
  onDeadline(): Promise<void> { return this.serial(() => this.doDeadline()); }
  /** A notification was clicked. The away warning brings the stage to the front (which resumes the visit). */
  onNotificationClicked(id: string): Promise<void> { return this.serial(() => this.doNotificationClicked(id)); }
  /** A notification button was clicked: Undo on the "stole" notification. */
  onNotificationButton(id: string, index: number): Promise<void> { return this.serial(() => this.doNotificationButton(id, index)); }
  /** Repaint the toolbar badge from stored state. */
  refreshBadge(): Promise<void> { return this.serial(async () => {}); }
  /** Working mode was switched off: a distracting visit in progress is abandoned (close nothing, spare nothing). A stale visit goes on. */
  onWorkingOff(): Promise<void> {
    return this.serial(async () => {
      const rt = await this.store.runtime();
      if (rt.visit && rt.visit.reason === 'distracting') await this.abandon(rt, rt.visit);
    });
  }
  undo(takenAt: number): Promise<void> { return this.serial(() => this.doUndo(takenAt)); }
  /** A window gained or lost focus. */
  onFocusChanged(): Promise<void> { return this.serial(() => this.doFocusChanged()); }

  // ---- internals (always called inside the queue) ----

  private memoFor(v: ActiveVisit): Memo | null { return this.memo && this.memo.visitId === v.visitId ? this.memo : null; }

  /** Clear the visit and save. Any started stale visit counts for the gap between visits. */
  private async end(rt: RuntimeState, v: ActiveVisit): Promise<RuntimeState> {
    const next: RuntimeState = { ...rt, visit: null };
    if (v.reason === 'stale') next.lastStaleVisitEnd = this.now();
    this.memo = null;
    await this.store.saveRuntime(next);
    await this.clearPause(v);
    return next;
  }

  /** Withdraw a paused visit's warning notification and deadline. */
  private async clearPause(v: ActiveVisit): Promise<void> {
    if (!v.pause) return;
    if (v.pause.notificationId) await this.browser.clearNotification(v.pause.notificationId);
    await this.browser.clearAlarm(DEADLINE_ALARM);
    this.deadlineTimer = null;
  }

  /** Badge priority: "!" while a visit is paused, else the working-mode dot, else nothing. */
  private async paintBadge(): Promise<void> {
    const rt = await this.store.runtime();
    const text = rt.visit?.pause ? '!' : rt.working ? ' ' : '';
    if (text === this.badge) return;
    this.badge = text;
    await this.browser.setBadge(text, BADGE_COLOR);
  }

  /** Cancel on the stage and unmark the target, best-effort. Closes nothing. */
  private async abandon(rt: RuntimeState, v: ActiveVisit): Promise<void> {
    await this.end(rt, v);
    await this.browser.send(v.targetTabId, { type: 'pockets/unmark' });
    await this.browser.send(v.stageTabId, { type: 'pockets/cancel', visitId: v.visitId });
  }

  /** True when the stage is the active tab of the focused window. */
  private async stageInFront(v: ActiveVisit): Promise<boolean> {
    const win = await this.browser.tabsInFocusedWindow();
    return !!win && win.tabs.some((t) => t.id === v.stageTabId && t.active && t.windowId === win.windowId);
  }

  /** Where the stage stands: in front, behind another tab in the browser, the user away from the browser, or gone. */
  private async frontState(v: ActiveVisit): Promise<Front> {
    if (await this.stageInFront(v)) return 'front';
    const stage = await this.browser.getTab(v.stageTabId);
    if (!stage) return 'gone';
    if (!(await this.browser.browserFocused())) return 'away';
    if (await this.browser.windowMinimized(stage.windowId)) return 'away';
    return 'tab';
  }

  /** A running visit whose stage is not in front is paused (or abandoned if the stage is gone). True if so. */
  private async pauseIfNotInFront(rt: RuntimeState, v: ActiveVisit): Promise<boolean> {
    if (await this.stageInFront(v)) return false;
    await this.reconcile(rt, v);
    return true;
  }

  private deadline(p: VisitPause): number { return (p.notifiedAt ?? p.at) + this.graceMs; }

  /** Bring the visit in line with where the stage stands now: pause, resume, notify, decide at the deadline, or wait. */
  private async reconcile(rt: RuntimeState, v: ActiveVisit): Promise<void> {
    const state = await this.frontState(v);
    if (state === 'gone') { await this.abandon(rt, v); return; }
    if (state === 'front') {
      if (v.pause) await this.resume(rt, v);
      return;
    }
    if (!v.pause) { await this.pause(rt, v, state === 'away'); return; }
    if (!(this.now() < this.deadline(v.pause))) { await this.decide(rt, v); return; }
    if (state === 'away' && !v.pause.notifyTried) this.confirmAway(v.visitId);
    await this.armDeadline(v);
  }

  /** The stage stopped being in front: stop the stage, unmark the target, persist the pause and set the deadline. */
  private async pause(rt: RuntimeState, v: ActiveVisit, away: boolean): Promise<void> {
    const memo = this.memoFor(v);
    if (!memo) { await this.abandon(rt, v); return; } // state we cannot account for: close nothing
    memo.takePending = false; // a stage-target take not yet completed is dropped
    const pause: VisitPause = { at: this.now(), bootId: await this.browser.bootId(), plan: memo.plan, windowId: memo.windowId };
    const next: ActiveVisit = { ...v, cardShown: false, pause };
    await this.store.saveRuntime({ ...rt, visit: next });
    await this.browser.send(v.stageTabId, { type: 'pockets/cancel', visitId: v.visitId });
    await this.browser.send(v.targetTabId, { type: 'pockets/unmark' });
    await this.armDeadline(next);
    if (away) this.confirmAway(v.visitId);
  }

  /** Set the deadline alarm, plus an in-worker timer while this worker lives (alarms can be late). */
  private async armDeadline(v: ActiveVisit): Promise<void> {
    if (!v.pause) return;
    const at = this.deadline(v.pause);
    await this.browser.setAlarm(DEADLINE_ALARM, at);
    const key = `${v.visitId}@${at}`;
    if (this.deadlineTimer === key) return;
    this.deadlineTimer = key;
    this.schedule(() => { void this.onDeadline(); }, Math.max(0, at - this.now()) + 250);
  }

  /** Check again shortly that the user really left the browser, then warn them once. */
  private confirmAway(visitId: string): void {
    if (this.confirmFor === visitId) return;
    this.confirmFor = visitId;
    this.schedule(() => { void this.serial(() => this.doConfirmAway(visitId)); }, AWAY_CONFIRM_MS);
  }

  private async doConfirmAway(visitId: string): Promise<void> {
    if (this.confirmFor === visitId) this.confirmFor = null;
    const rt = await this.store.runtime();
    const v = rt.visit;
    if (!v || v.visitId !== visitId || !v.pause) return;
    if ((await this.frontState(v)) !== 'away' || !(this.now() < this.deadline(v.pause))) { await this.reconcile(rt, v); return; }
    if (!v.pause.notifyTried) await this.notify(rt, v);
  }

  /** The away warning. notifiedAt and notificationId are recorded only if the notification was created. */
  private async notify(rt: RuntimeState, v: ActiveVisit): Promise<void> {
    const p = v.pause!;
    const id = AWAY_NOTIFICATION + v.visitId;
    const ok = await this.browser.createNotification(id, { title: `Pockets has his eye on “${p.plan.title}”`, message: AWAY_MESSAGE });
    const pause: VisitPause = { ...p, notifyTried: true, ...(ok === true ? { notifiedAt: this.now(), notificationId: id } : {}) };
    const next: ActiveVisit = { ...v, pause };
    await this.store.saveRuntime({ ...rt, visit: next });
    await this.armDeadline(next);
  }

  /** The stage is back in front: replay the visit under a new id with the full countdown. A take needs a new card-shown. */
  private async resume(rt: RuntimeState, v: ActiveVisit): Promise<void> {
    const p = v.pause!;
    await this.clearPause(v);
    const target = await this.browser.getTab(v.targetTabId);
    if (!target || !tabMatches(target, v, p.windowId)) { await this.abandon(rt, v); return; }
    const s = await this.store.settings();
    const tabCount = (await this.browser.tabCountInWindow(target.windowId)) || p.plan.tabCount;
    const started = await this.start({ ...rt, visit: null }, target, v.reason, v.stageTabId, tabCount, s.countdownSeconds,
      p.plan.title, p.plan.faviconUrl, true);
    if (!started) {
      await this.browser.send(v.targetTabId, { type: 'pockets/unmark' });
      await this.end(await this.store.runtime(), v);
    }
  }

  /** The deadline has passed. Take only on the away path; otherwise end quietly (close nothing). */
  private async decide(rt: RuntimeState, v: ActiveVisit): Promise<void> {
    const state = await this.frontState(v);
    if (state === 'gone') { await this.abandon(rt, v); return; }
    if (state === 'front') { await this.resume(rt, v); return; }
    if (state === 'away' && (await this.takeAllowed(v, 'away')) && (await this.targetStillValid(rt, v))
        && (await this.awayEligible(v))) {
      await this.finishTake(rt, v, 'away');
      return;
    }
    await this.abandon(rt, v);
  }

  /**
   * The two ways a tab may be closed (the revised first safety rule).
   *   card: the card of the current play was confirmed on screen, and the visit is not paused.
   *   away: paused; a notification about this exact visit was created at least graceMs ago and not clicked; this browser
   *         run; and no browser window is focused right now.
   */
  private async takeAllowed(v: ActiveVisit, path: 'card' | 'away'): Promise<boolean> {
    if (path === 'card') return v.cardShown === true && v.pause === undefined;
    const p = v.pause;
    if (!p || typeof p.notifiedAt !== 'number' || p.notificationId !== AWAY_NOTIFICATION + v.visitId || p.clickedAt !== undefined) return false;
    if (!(this.now() - p.notifiedAt >= this.graceMs)) return false;
    if (p.bootId !== (await this.browser.bootId())) return false;
    return (await this.browser.browserFocused()) === false;
  }

  /** The away path waits five minutes or more after the pick: the target must still pass pickTarget's per-tab rules. */
  private async awayEligible(v: ActiveVisit): Promise<boolean> {
    const t = await this.browser.getTab(v.targetTabId);
    if (!t) return false;
    return stillEligible(t, v.reason, await this.store.settings(), await this.store.runtime(), this.now());
  }

  private async doDeadline(): Promise<void> {
    const rt = await this.store.runtime();
    const v = rt.visit;
    if (!v?.pause) return;
    if (this.now() < this.deadline(v.pause)) { await this.browser.setAlarm(DEADLINE_ALARM, this.deadline(v.pause)); return; }
    await this.decide(rt, v);
  }

  private async doNotificationClicked(id: string): Promise<void> {
    if (id.startsWith(TAKEN_NOTIFICATION)) { await this.browser.clearNotification(id); return; }
    if (!id.startsWith(AWAY_NOTIFICATION)) return;
    const rt = await this.store.runtime();
    const v = rt.visit;
    if (!v?.pause || v.pause.notificationId !== id) { await this.browser.clearNotification(id); return; }
    // The user answered the warning: from now on this pause never takes while away; the focus change resumes the visit.
    await this.store.saveRuntime({ ...rt, visit: { ...v, pause: { ...v.pause, clickedAt: this.now() } } });
    await this.browser.focusTab(v.stageTabId);
  }

  private async doNotificationButton(id: string, index: number): Promise<void> {
    if (!id.startsWith(TAKEN_NOTIFICATION) || index !== 0) return;
    const takenAt = Number(id.slice(TAKEN_NOTIFICATION.length));
    await this.browser.clearNotification(id);
    if (Number.isFinite(takenAt)) await this.doUndo(takenAt);
  }

  private visitSilent(v: ActiveVisit): boolean {
    const last = this.memoFor(v)?.lastEventAt ?? v.startedAt;
    return !(this.now() - last < ABANDON_MS);
  }

  private async doTick(): Promise<void> {
    const rt = await this.store.runtime();
    const now = this.now();
    if (rt.visit) {
      // A paused stage sends nothing: no silence rule; the tick backs up the deadline alarm instead.
      if (rt.visit.pause) await this.reconcile(rt, rt.visit);
      else if (this.visitSilent(rt.visit)) await this.abandon(rt, rt.visit);
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
                      tabCount: number, countdownSeconds: number, title = target.title, favIconUrl = target.favIconUrl,
                      resume = false): Promise<boolean> {
    const now = this.now();
    const visit: ActiveVisit = { visitId: this.newId(), targetTabId: target.id, targetUrl: target.url, stageTabId, reason,
      cardShown: false, startedAt: now };
    const plan: VisitPlan = { visitId: visit.visitId, targetTabId: target.id, title, faviconUrl: favIconUrl, reason,
      reasonText: reasonText(reason, target.lastAccessed, now), tabIndex: target.index, tabCount,
      countdownSeconds: Math.max(1, Math.round(countdownSeconds)), targetIsStage: stageTabId === target.id,
      ...(resume ? { resume: true as const } : {}) };
    if (plan.faviconUrl === undefined) delete plan.faviconUrl;
    await this.store.saveRuntime({ ...rt, visit });
    this.memo = { visitId: visit.visitId, title, favIconUrl, windowId: target.windowId, plan, lastEventAt: now, takePending: false };
    const ok = await this.browser.send(stageTabId, { type: 'pockets/play', plan });
    if (!ok) {
      // Re-read: nothing else can run meanwhile (queue), but keep the write minimal.
      const cur = await this.store.runtime();
      if (cur.visit?.visitId === visit.visitId) await this.store.saveRuntime({ ...cur, visit: null });
      this.memo = null;
      // The reply may only have timed out: tell a late stage not to play a visit nobody is running.
      await this.browser.send(stageTabId, { type: 'pockets/cancel', visitId: visit.visitId });
      return false;
    }
    return true;
  }

  private async doEvent(tabId: number, visitId: string, e: VisitEvent): Promise<void> {
    const rt = await this.store.runtime();
    const v = rt.visit;
    if (!v || v.visitId !== visitId || tabId !== v.stageTabId) return;
    // A paused visit hears nothing from its stage (it was told to cancel; a resume replays under a new visit id).
    if (v.pause) return;
    // Hard rule 6: a visit silent for 60 s is abandoned, whatever event arrives next.
    if (this.visitSilent(v)) { await this.abandon(rt, v); return; }
    const memo = this.memoFor(v);
    if (memo) memo.lastEventAt = this.now();

    switch (e.type) {
      case 'card-shown': {
        // Persist first; then make sure the user can actually see the stage.
        const shown: RuntimeState = { ...rt, visit: { ...v, cardShown: true } };
        if (v.cardShown !== true) await this.store.saveRuntime(shown);
        await this.pauseIfNotInFront(shown, shown.visit!);
        return;
      }
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
        if (await this.pauseIfNotInFront(rt, v)) return;
        if (!(await this.targetStillValid(rt, v))) { await this.abandon(rt, v); return; }
        if (v.targetTabId !== v.stageTabId) { await this.finishTake(rt, v, 'card'); return; }
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
      case 'alive':
        // The stage is still climbing: lastEventAt was refreshed above, nothing else to do.
        return;
      case 'hidden':
        // The card was not on screen when the take was due. If the user left the stage, pause. Otherwise (say, a modal
        // dialog over the card): as if abandoned. Cancel, unmark, close nothing, spare nothing; a stale visit starts the gap.
        if (await this.pauseIfNotInFront(rt, v)) return;
        await this.abandon(rt, v);
        return;
      default:
        return;
    }
  }

  private async completeStageTake(visitId: string): Promise<void> {
    const rt = await this.store.runtime();
    const v = rt.visit;
    if (!v || v.visitId !== visitId || v.pause || !this.memoFor(v)?.takePending) return;
    if (v.cardShown !== true || !(await this.targetStillValid(rt, v))) { await this.abandon(rt, v); return; }
    await this.finishTake(rt, v, 'card');
  }

  /** Re-read the target: it must still exist with the same URL, in the same window, unpinned, and not typed into. */
  private async targetStillValid(rt: RuntimeState, v: ActiveVisit): Promise<boolean> {
    if (rt.typedIn.includes(v.targetTabId)) return false; // typed into during the visit: closing would lose work
    return tabMatches(await this.browser.getTab(v.targetTabId), v, this.memoFor(v)?.windowId ?? v.pause?.windowId);
  }

  /** Close exactly v.targetTabId. Callers have checked takeAllowed and re-read the target. */
  private async finishTake(rt: RuntimeState, v: ActiveVisit, path: 'card' | 'away'): Promise<void> {
    if (!(await this.takeAllowed(v, path))) { await this.abandon(rt, v); return; } // belt and braces
    const memo = this.memoFor(v);
    const windowId = memo?.windowId ?? v.pause?.windowId;
    const known = memo ?? (v.pause ? { title: v.pause.plan.title, favIconUrl: v.pause.plan.faviconUrl } : null);
    const target = known ? null : await this.browser.getTab(v.targetTabId);
    const title = known?.title ?? target?.title ?? v.targetUrl;
    const favIconUrl = known ? known.favIconUrl : target?.favIconUrl;
    const takenAt = this.now();
    const after = await this.end(rt, v);
    // Record first, so a worker death between close and record cannot lose a closed tab.
    const entry = { title, url: v.targetUrl, takenAt, reason: v.reason, ...(favIconUrl ? { favIconUrl } : {}) };
    await this.store.addTaken(entry);
    // Hard rule 2, again at the last moment: the store writes above took time. Read everything else first, so nothing
    // is awaited between this re-read and removeTab, which itself checks the URL once more right before closing.
    // The away path's conditions are checked once more here (the browser may have been focused meanwhile), then the
    // target must not be the only tab in its window.
    const allowed = path === 'card' || (await this.takeAllowed(v, 'away'));
    const nowRt = await this.store.runtime();
    const typed = nowRt.typedIn.includes(v.targetTabId);
    const settings = path === 'away' ? await this.store.settings() : null;
    const others = allowed && !typed && windowId !== undefined ? (await this.browser.tabCountInWindow(windowId)) > 1 : false;
    const last = others ? await this.browser.getTab(v.targetTabId) : null;
    // Away path: pickTarget's per-tab rules once more, on this same re-read (synchronous: nothing awaited before removeTab).
    const eligible = !settings || (!!last && stillEligible(last, v.reason, settings, nowRt, this.now()));
    let closed = false;
    if (others && eligible && tabMatches(last, v, windowId)) {
      try {
        closed = await this.browser.removeTab(v.targetTabId, v.targetUrl);
      } catch {
        closed = false;
      }
    }
    if (closed !== true) {
      // Not taken: no record, nothing counted, and the stage must not play a grab for it.
      await this.store.removeTaken(takenAt);
      await this.browser.send(v.targetTabId, { type: 'pockets/unmark' });
      await this.browser.send(v.stageTabId, { type: 'pockets/cancel', visitId: v.visitId });
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

    if (path === 'away') {
      // The user is not looking at any page: the notice is a system notification with Undo.
      await this.browser.createNotification(TAKEN_NOTIFICATION + takenAt,
        { title: `Pockets stole “${title}”`, message: TAKEN_MESSAGE, buttons: ['Undo'] });
      return;
    }
    const notice: ToContent = { type: 'pockets/notice', title, takenAt };
    let noticeTabId: number | undefined;
    if (v.stageTabId !== v.targetTabId) {
      noticeTabId = v.stageTabId;
    } else {
      const win = await this.browser.tabsInFocusedWindow();
      noticeTabId = win?.tabs.find((t) => t.active && t.id !== v.targetTabId)?.id;
    }
    if (noticeTabId === undefined) return;
    // Remember who was shown the notice, so only that tab can ask for this undo. Saved before sending.
    const saved = (await this.store.taken()).find((t) => t.takenAt === takenAt);
    if (saved) {
      await this.store.removeTaken(takenAt);
      await this.store.addTaken({ ...saved, noticeTabId });
    }
    await this.browser.send(noticeTabId, notice);
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
    if (!v) return;
    if (tabId !== v.targetTabId || v.targetTabId === v.stageTabId) {
      // Another tab was activated (pause if the stage is no longer in front), or the stage itself (resume if paused).
      await this.reconcile(rt, v);
      return;
    }
    if (v.reason === 'stale') {
      // Treated as Keep, without the grumpy card text.
      const s = await this.store.settings();
      await this.end(spareKept(rt, v.targetTabId, 'stale', s, this.now()), v);
      await this.browser.send(v.targetTabId, { type: 'pockets/unmark' });
      await this.browser.send(v.stageTabId, { type: 'pockets/cancel', visitId: v.visitId });
      return;
    }
    // Distracting: not saved. Replay with the target as the stage and the time remaining (the full countdown after a pause).
    const memo = this.memoFor(v);
    await this.browser.send(v.stageTabId, { type: 'pockets/cancel', visitId: v.visitId });
    const target = await this.browser.getTab(v.targetTabId);
    if (!target || target.url !== v.targetUrl) { await this.abandon(rt, v); return; }
    await this.clearPause(v);
    const s = await this.store.settings();
    const remaining = v.pause ? s.countdownSeconds : memo?.remaining ?? s.countdownSeconds;
    const tabCount = memo?.plan.tabCount ?? v.pause?.plan.tabCount ?? target.index + 1;
    const known = memo ?? (v.pause ? { title: v.pause.plan.title, favIconUrl: v.pause.plan.faviconUrl } : null);
    const started = await this.start({ ...rt, visit: null }, target, 'distracting', target.id, tabCount, remaining,
      known?.title ?? target.title, known ? known.favIconUrl : target.favIconUrl);
    if (!started) {
      await this.browser.send(v.targetTabId, { type: 'pockets/unmark' });
      await this.end(await this.store.runtime(), v);
    }
  }

  private async doFocusChanged(): Promise<void> {
    const rt = await this.store.runtime();
    if (rt.visit) await this.reconcile(rt, rt.visit);
  }

  private async doUndo(takenAt: number): Promise<void> {
    const entry = (await this.store.taken()).find((t) => t.takenAt === takenAt);
    if (!entry) return;
    const restored = entry.sessionId ? await this.browser.restore(entry.sessionId, entry.url) : false;
    if (!restored) await this.browser.openUrl(entry.url);
    await this.store.removeTaken(takenAt);
  }
}
