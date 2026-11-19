// The choreography of one visit, free of the DOM: it moves a Rig, drives a CardView and emits VisitEvents.
// Timings and paths follow the approved mock (docs/spikes/mock-hand-drawn.html, go.onclick).
import type { Pt } from './rig/chain';
import type { VisitEvent, VisitPlan } from '../shared/types';

/** The parts of Rig the sequence drives (Rig itself satisfies this). */
export interface RigLike {
  travel(path: Pt[], speed: number, opts?: { rest?: boolean }): Promise<boolean>;
  setLook(on: boolean): void;
  setReach(on: boolean): void;
  setStretch(target: number): void;
}

/** The warning card as the sequence sees it. card.ts implements it on the DOM. */
export interface CardView {
  /** Show the card with its top-left corner at `at` (viewport px). Resolves true once it is actually
   *  visible on screen, or false if the visit was cancelled first. */
  show(at: { left: number; top: number }, text: { title: string; sub: string }, onKeep: () => void): Promise<boolean>;
  /** Whether the card is on screen right now (checked again just before a take). */
  visible(): boolean;
  /** Show `remaining` of `total` seconds on the ring and the title ("Mine in 3…"). */
  count(remaining: number, total: number): void;
  /** Switch to the kept text and hide the Keep button. */
  kept(title: string, sub: string): void;
  hide(): void;
}

/** What the renderer draws in Pockets' mouth: a tab falling from `from` into it, or held there. */
export type Carry = { phase: 'drop'; from: Pt; ms: number } | { phase: 'held' };

export interface SequenceDeps {
  /** Make the Rig for this visit, with its head at `start` facing `heading` (radians). */
  createRig(start: Pt, heading: number): RigLike;
  card: CardView;
  view: { width: number; height: number };
  /** prefers-reduced-motion: reduce. No crawl; the card sits top-left with Pockets still beside it. */
  reduced: boolean;
  rand: () => number;
  /** Aborted by Stage.cancel(): the sequence stops at its next step and emits nothing more. */
  signal: AbortSignal;
  setCarry(carry: Carry | null): void;
  /** Hide Pockets (reduced motion has no walk-off). Optional. */
  setVisible?(on: boolean): void;
}

/** Card geometry shared with card.ts. */
export const CARD_WIDTH = 250;
export const CARD_TOP = 70;
export const CARD_MARGIN = 12;

// Speeds (px/s) and timings (ms) from the mock.
const PEEK_SPEED = 60;
const LOOK_MS = 1200;
const CLIMB_SPEED = 165;
const CLIMB_JITTER = 7;
const LEAVE_SPEED = 150;
const BOLT_SPEED = 400;
const DROP_MS = 380;
const CROUCH = 0.74;
const CROUCH_MS = 300;
const SPRING = 1.12;
const KEPT_MS = 1500;
const BORDER_X = 30;
/** How often the stage says it is still playing, from play until card-shown. MV3 stops a service worker that has
 *  heard nothing for about 30 s, and a long climb on a big screen sends no other event. */
export const ALIVE_MS = 10_000;
/** How long the countdown phase waits for the card to be on screen before giving up with hidden. */
export const SHOW_TIMEOUT_MS = 10_000;

/**
 * Where a tab's centre probably is, in viewport px. Extensions cannot read the tab strip, so this models
 * Chrome's: tabs start about 8 px from the window's left edge, share the width left of about 100 px kept for
 * the new-tab button and window controls, and are at most 240 px wide. Clamped to [60, width - 40] so
 * Pockets always has room to climb up the left border and reach.
 */
export function estimateTabX(tabIndex: number, tabCount: number, viewportWidth: number): number {
  const left = 8;
  const reserve = 100;
  const count = Math.max(1, tabCount);
  const index = Math.max(0, Math.min(count - 1, tabIndex));
  const tabW = Math.min(240, Math.max(0, viewportWidth - left - reserve) / count);
  const x = left + tabW * (index + 0.5);
  return Math.max(60, Math.min(viewportWidth - 40, x));
}

/** The card's top-left corner for a reach at `tx`: right of Pockets if it fits, else left of it. */
export function cardPosition(tx: number, width: number, reduced: boolean): { left: number; top: number } {
  if (reduced) return { left: CARD_MARGIN, top: CARD_MARGIN };
  const w = Math.min(CARD_WIDTH, width - 2 * CARD_MARGIN);
  let left = tx + 34;
  if (left + w > width - CARD_MARGIN) left = tx - 34 - w;
  return { left: Math.max(CARD_MARGIN, Math.min(width - CARD_MARGIN - w, left)), top: CARD_TOP };
}

/**
 * Play one visit. Resolves after `done`, or as soon as `deps.signal` aborts (then nothing more is emitted).
 * Events: card-shown (only once the card is on screen), tick N … tick 1 a second apart, then either keep
 * (when Keep is clicked) or take (one second after tick 1), and done once Pockets has gone. If the card is not on
 * screen when the take is due (say the page opened a modal dialog over it), hidden is emitted instead of take and
 * the visit ends there, with no done; the same happens if the card has not come on screen within ten seconds of
 * the countdown phase starting. From play until card-shown (or hidden), alive is emitted every ten seconds so the
 * background's service worker is not stopped mid-climb; it stops on card-shown, on abort and when the visit ends.
 */
export async function runVisit(plan: VisitPlan, emit: (e: VisitEvent) => void, deps: SequenceDeps): Promise<void> {
  const { signal } = deps;
  if (signal.aborted) return;
  const timer = setInterval(() => { if (!signal.aborted) emit({ type: 'alive' }); }, ALIVE_MS);
  const stopAlive = (): void => clearInterval(timer);
  signal.addEventListener('abort', stopAlive, { once: true });
  try {
    await playVisit(plan, emit, deps, stopAlive);
  } finally {
    stopAlive();
    signal.removeEventListener('abort', stopAlive);
  }
}

async function playVisit(plan: VisitPlan, emit: (e: VisitEvent) => void, deps: SequenceDeps, stopAlive: () => void): Promise<void> {
  const { signal, card, view, rand } = deps;
  const W = view.width;
  const H = view.height;
  const live = (): boolean => !signal.aborted;
  const out = (e: VisitEvent): void => {
    if (live()) emit(e);
  };

  let keepPressed = false;
  let counting = false;
  let wakeKeep: (() => void) | null = null;
  const onKeep = (): void => {
    if (keepPressed || !live() || !counting) return;
    keepPressed = true;
    wakeKeep?.();
  };

  /** Wait `ms`; resolves early on abort (and on Keep when `untilKeep`). Returns whether still live. */
  const wait = (ms: number, untilKeep = false): Promise<boolean> =>
    new Promise((res) => {
      if (!live()) return res(false);
      const done = (): void => {
        clearTimeout(timer);
        signal.removeEventListener('abort', done);
        if (untilKeep) wakeKeep = null;
        res(live());
      };
      const timer = setTimeout(done, ms);
      signal.addEventListener('abort', done);
      if (untilKeep) wakeKeep = done;
    });

  /** Settle with `p`, or with `onAbort` as soon as the visit is cancelled, whichever comes first. Hidden tabs
   *  pause requestAnimationFrame, so the card's show() and the rig's travel() may otherwise never settle. */
  const orAbort = <T>(p: Promise<T>, onAbort: T): Promise<T> =>
    new Promise<T>((res) => {
      if (!live()) return res(onAbort);
      const stop = (): void => res(onAbort);
      signal.addEventListener('abort', stop, { once: true });
      p.then((v) => {
        signal.removeEventListener('abort', stop);
        res(v);
      }, () => {
        signal.removeEventListener('abort', stop);
        res(onAbort);
      });
    });

  const tx = estimateTabX(plan.tabIndex, plan.tabCount, W);
  const at = cardPosition(tx, W, deps.reduced);
  const total = Math.max(1, Math.round(plan.countdownSeconds));
  const text = { title: `Mine in ${total}…`, sub: `${plan.title} · ${plan.reasonText}` };

  if (deps.reduced) {
    // No crawl: Pockets sits still beside the card, facing up.
    const w = Math.min(CARD_WIDTH, W - 2 * CARD_MARGIN);
    const besideX = at.left + w + 40;
    const start = besideX < W - 30 ? { x: besideX, y: 34 } : { x: at.left + 40, y: at.top + 150 };
    const rig = deps.createRig(start, -Math.PI / 2);
    deps.setVisible?.(true);
    rig.setReach(true);
    const outcome = await countdown(rig);
    if (outcome === 'cancelled') return;
    if (outcome === 'keep') {
      if (!(await wait(KEPT_MS))) return;
      card.hide();
    } else {
      deps.setCarry({ phase: 'held' });
      if (!(await wait(KEPT_MS))) return;
    }
    deps.setVisible?.(false);
    deps.setCarry(null);
    out({ type: 'done' });
    return;
  }

  const rig = deps.createRig({ x: BORDER_X, y: H + 36 }, -Math.PI / 2);
  deps.setVisible?.(true);
  // One travel() per leg, as in the mock. The rig's steering timeout scales with the path, so a long leg
  // on a big screen is not cut short.
  const go = async (path: Pt[], speed: number, rest?: boolean): Promise<boolean> => {
    if (!live()) return false;
    const arrived = await orAbort(rig.travel(path, speed, rest === undefined ? undefined : { rest }), false);
    return arrived && live();
  };
  const jx = (): number => BORDER_X + (rand() * 2 - 1) * CLIMB_JITTER;

  // Peek in at the bottom and look around.
  if (!(await go([{ x: BORDER_X, y: H - 6 }], PEEK_SPEED, false))) return;
  rig.setLook(true);
  if (!(await wait(LOOK_MS))) return;
  rig.setLook(false);

  // Climb the left border, then cross the top to under the target tab and turn up to it.
  if (!(await go([{ x: jx(), y: H * 0.72 }, { x: jx(), y: H * 0.48 }, { x: jx(), y: H * 0.27 }, { x: 32, y: 64 }], CLIMB_SPEED))) return;
  const cross = [
    { x: 62, y: 54 }, { x: (62 + tx) / 2, y: 70 + (rand() - 0.5) * 12 }, { x: tx - 32, y: 66 }, { x: tx - 5, y: 50 }, { x: tx, y: 24 },
  ];
  if (!(await go(cross, CLIMB_SPEED))) return;
  rig.setReach(true);

  const outcome = await countdown(rig);
  if (outcome === 'cancelled') return;

  if (outcome === 'keep') {
    if (!(await wait(KEPT_MS))) return;
    card.hide();
    if (!(await go([{ x: tx + 34, y: 76 }, { x: tx + 6, y: 150 }, { x: Math.max(50, tx - 80), y: H + 110 }], LEAVE_SPEED))) return;
  } else {
    // The tab drops off the bar into Pockets' mouth; it crouches, springs and bolts off the bottom.
    deps.setCarry({ phase: 'drop', from: { x: tx, y: -12 }, ms: DROP_MS });
    if (!(await wait(DROP_MS))) return;
    deps.setCarry({ phase: 'held' });
    rig.setStretch(CROUCH);
    if (!(await wait(CROUCH_MS))) return;
    rig.setStretch(SPRING);
    if (!(await go([{ x: tx + 52, y: 84 }, { x: tx + 26, y: 160 }, { x: Math.max(50, tx - 90), y: H + 130 }], BOLT_SPEED))) return;
    rig.setStretch(1);
  }
  deps.setCarry(null);
  deps.setVisible?.(false);
  out({ type: 'done' });

  /** Show the card, run the countdown and settle keep or take. The card is hidden on take. */
  async function countdown(r: RigLike): Promise<'keep' | 'take' | 'cancelled'> {
    // Wait at most SHOW_TIMEOUT_MS for the card to be on screen (say a popover covers it): then give up with hidden.
    let showTimer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<'timeout'>((res) => { showTimer = setTimeout(() => res('timeout'), SHOW_TIMEOUT_MS); });
    const shown = await orAbort<boolean | 'timeout'>(Promise.race([card.show(at, text, onKeep), timedOut]), false);
    clearTimeout(showTimer);
    if (shown === 'timeout') {
      if (!live()) return 'cancelled';
      stopAlive();
      r.setReach(false);
      out({ type: 'hidden' });
      card.hide();
      return 'cancelled';
    }
    if (!shown || !live()) return 'cancelled';
    stopAlive(); // the ticks keep the worker awake from here
    out({ type: 'card-shown' });
    counting = true;
    for (let n = total; n >= 1; n--) {
      out({ type: 'tick', remaining: n });
      card.count(n, total);
      if (!(await wait(1000, true))) {
        counting = false;
        return 'cancelled';
      }
      if (keepPressed) break;
    }
    counting = false;
    r.setReach(false);
    if (!live()) return 'cancelled';
    if (keepPressed) {
      out({ type: 'keep' });
      card.kept('Fine. Keep it.', `Pockets will leave ${plan.title} alone for now.`);
      return 'keep';
    }
    // The take needs the card to be visible now, not only when it first showed.
    if (!card.visible()) {
      out({ type: 'hidden' });
      card.hide();
      return 'cancelled';
    }
    out({ type: 'take' });
    card.hide();
    return 'take';
  }
}
