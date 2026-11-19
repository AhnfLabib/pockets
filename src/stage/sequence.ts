// The choreography of one visit, free of the DOM: it moves a Rig, drives a CardView and emits VisitEvents.
// Timings and paths follow the approved mock (docs/spikes/mock-hand-drawn.html, go.onclick).
import type { Pt } from './rig/chain';
import { QUIRK_KINDS, type Quirk, type QuirkKind } from './rig/rig';
import { TEMPO } from './rig/tempo';
import { QUOTE_MS, quotePool } from './quotes';
import { cleanTitle } from '../shared/title';
import type { VisitEvent, VisitPlan } from '../shared/types';

export { TEMPO };

/** The parts of Rig the sequence drives (Rig itself satisfies this). */
export interface RigLike {
  travel(path: Pt[], speed: number, opts?: { rest?: boolean; quirks?: Quirk[] }): Promise<boolean>;
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
  /** Show a speech bubble by Pockets' head (null hides it). Optional. */
  say?(text: string | null): void;
  /** The last known pointer position on the page (viewport px), or null. Optional. */
  pointer?(): Pt | null;
}

/** Card geometry shared with card.ts. */
export const CARD_WIDTH = 250;
export const CARD_TOP = 70;
export const CARD_MARGIN = 12;

/** Speeds (px/s) from the approved mock, before the tempo. */
export const BASE_SPEED = { peek: 60, climb: 165, leave: 150, bolt: 400 } as const;
/** The speeds the choreography uses: the mock's, TEMPO times faster. Climb covers the crossing too. */
export const SPEED = {
  peek: BASE_SPEED.peek * TEMPO, climb: BASE_SPEED.climb * TEMPO, leave: BASE_SPEED.leave * TEMPO, bolt: BASE_SPEED.bolt * TEMPO,
} as const;
// Choreographed pauses (ms) from the mock, shortened by the tempo.
const LOOK_MS = 1200 / TEMPO;
const DROP_MS = 380 / TEMPO;
const CROUCH_MS = 300 / TEMPO;
const KEPT_MS = 1500 / TEMPO;
/** Reduced motion keeps the mock's hold (it has no movement to speed up). */
const REDUCED_HOLD_MS = 1500;
const CLIMB_JITTER = 7;
const CROUCH = 0.74;
const SPRING = 1.12;
const BORDER_X = 30;
/** A generous estimate of the card's height, for keeping exit routes clear of it. */
const CARD_HEIGHT_EST = 150;
/** How far the exit routes keep from the card's edges (Pockets is about 28 px wide). */
const CARD_CLEARANCE = 26;
/** How far off the page an exit ends, so the tail is gone too. */
const OFF = 130;
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

export type Entrance = 'bottom-left' | 'bottom-right' | 'left' | 'right';
export type Exit = 'bottom' | 'left' | 'right' | 'bottom-left' | 'bottom-right';
export const ENTRANCES: readonly Entrance[] = ['bottom-left', 'bottom-right', 'left', 'right'];
export const EXITS: readonly Exit[] = ['bottom', 'left', 'right', 'bottom-left', 'bottom-right'];

/** A quirk as planned: on the climb or the crossing, `frac` of the way along it (tiptoe: always at the crossing's end). */
export interface PlannedQuirk { kind: QuirkKind; leg: 'climb' | 'cross'; frac: number; side: number }

/** Everything random about one visit's movement, drawn before it starts so a seed always gives the same visit. */
export interface Choreography {
  entrance: Entrance;
  /** For edge entrances: where on the edge, as a fraction of the viewport height (lower half). */
  edgeY: number;
  exit: Exit;
  /** Where along the exit edge (0..1), for bottom and side exits. */
  exitT: number;
  quirks: PlannedQuirk[];
  quote: string | null;
}

const pick = <T>(rand: () => number, list: readonly T[]): T => list[Math.min(list.length - 1, Math.floor(rand() * list.length))];

/**
 * Draw one visit's entrance, exit, quirks (0-2) and quote (about half of visits) from `rand`, in a fixed order.
 * Reduced motion and resumed visits get no quirks and no quote. lookAtPointer is only picked when a pointer
 * position is known.
 */
export function planChoreography(
  rand: () => number,
  opts: { reduced: boolean; resume?: boolean; reason: 'stale' | 'distracting'; pointerKnown: boolean },
): Choreography {
  const entrance = pick(rand, ENTRANCES);
  const edgeY = 0.55 + rand() * 0.33;
  const exit = pick(rand, EXITS);
  const exitT = rand();
  const quirks: PlannedQuirk[] = [];
  let quote: string | null = null;
  if (!opts.reduced && !opts.resume) {
    const r = rand();
    const n = r < 0.3 ? 0 : r < 0.75 ? 1 : 2;
    const pool = QUIRK_KINDS.filter((k) => k !== 'lookAtPointer' || opts.pointerKnown);
    for (let i = 0; i < n; i++) {
      const left = pool.filter((k) => !quirks.some((q) => q.kind === k));
      const kind = pick(rand, left);
      const leg: 'climb' | 'cross' = kind === 'tiptoe' ? 'cross' : rand() < 0.55 ? 'climb' : 'cross';
      quirks.push({ kind, leg, frac: 0, side: rand() < 0.5 ? -1 : 1 });
    }
    // Spread quirks on the same leg apart: the first in its first half, the second in its second.
    for (const leg of ['climb', 'cross'] as const) {
      const on = quirks.filter((q) => q.leg === leg && q.kind !== 'tiptoe');
      on.forEach((q, i) => { q.frac = on.length === 1 ? 0.2 + rand() * 0.55 : i === 0 ? 0.15 + rand() * 0.25 : 0.55 + rand() * 0.25; });
    }
    if (rand() < 0.5) quote = pick(rand, quotePool(opts.reason));
  }
  return { entrance, edgeY, exit, exitT, quirks, quote };
}

const clampTo = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(Math.max(lo, hi), v));
const pathLength = (from: Pt, path: Pt[]): number => {
  let len = 0;
  let prev = from;
  for (const p of path) { len += Math.hypot(p.x - prev.x, p.y - prev.y); prev = p; }
  return len;
};

/** Where Pockets starts, where his head pokes in, which border he climbs and the climb waypoints. */
export function entranceRoute(
  c: Choreography, view: { width: number; height: number }, rand: () => number,
): { start: Pt; heading: number; peek: Pt; side: 'left' | 'right'; climb: Pt[] } {
  const W = view.width;
  const H = view.height;
  const side: 'left' | 'right' = c.entrance === 'bottom-left' || c.entrance === 'left' ? 'left' : 'right';
  const bx = side === 'left' ? BORDER_X : W - BORDER_X;
  const jx = (): number => bx + (rand() * 2 - 1) * CLIMB_JITTER;
  const top = { x: side === 'left' ? 32 : W - 32, y: 64 };
  if (c.entrance === 'bottom-left' || c.entrance === 'bottom-right') {
    return {
      start: { x: bx, y: H + 36 }, heading: -Math.PI / 2, peek: { x: bx, y: H - 6 }, side,
      climb: [{ x: jx(), y: H * 0.72 }, { x: jx(), y: H * 0.48 }, { x: jx(), y: H * 0.27 }, top],
    };
  }
  const y0 = clampTo(H * c.edgeY, Math.min(H - 40, 110), H - 40);
  const climb = [0.3, 0.6, 0.82].map((f) => y0 + (64 - y0) * f).filter((y) => y > 64 + 20 && y < y0 - 20).map((y) => ({ x: jx(), y }));
  climb.push(top);
  return side === 'left'
    ? { start: { x: -36, y: y0 }, heading: 0, peek: { x: 6, y: y0 }, side, climb }
    : { start: { x: W + 36, y: y0 }, heading: Math.PI, peek: { x: W - 6, y: y0 }, side, climb };
}

/** Along the top from the border he climbed to under the tab, turning up to it. */
export function crossRoute(side: 'left' | 'right', tx: number, view: { width: number }, rand: () => number): Pt[] {
  const W = view.width;
  const x = (v: number): number => clampTo(v, BORDER_X, W - BORDER_X);
  const d = side === 'left' ? 1 : -1;
  const from = side === 'left' ? 62 : W - 62;
  return [
    { x: from, y: 54 }, { x: x((from + tx) / 2), y: 70 + (rand() - 0.5) * 12 }, { x: x(tx - d * 32), y: 66 }, { x: x(tx - d * 5), y: 50 }, { x: tx, y: 24 },
  ];
}

/** The card's keep-out box for exit routes. */
export function cardKeepOut(at: { left: number; top: number }, width: number): { l: number; t: number; r: number; b: number } {
  const w = Math.min(CARD_WIDTH, width - 2 * CARD_MARGIN);
  return { l: at.left - CARD_CLEARANCE, t: at.top - CARD_CLEARANCE, r: at.left + w + CARD_CLEARANCE, b: at.top + CARD_HEIGHT_EST + CARD_CLEARANCE };
}

/** From under the tab off the page through the planned edge: first down on the side away from the card, then below
 *  it, then out. Every waypoint but the last is inside the viewport. */
export function exitRoute(
  c: Choreography, tx: number, at: { left: number; top: number }, view: { width: number; height: number },
): Pt[] {
  const W = view.width;
  const H = view.height;
  const k = cardKeepOut(at, W);
  const cardRight = at.left > tx;
  const away = cardRight ? -1 : 1;
  const x1 = cardRight ? Math.min(tx - 6, k.l - 12) : Math.max(tx + 6, k.r + 12);
  const inX = (v: number): number => clampTo(v, BORDER_X, W - BORDER_X);
  const inY = (v: number): number => clampTo(v, 24, H - 30);
  const p1 = { x: inX(x1 + away * 14), y: inY(90) };
  const p2 = { x: inX(x1 + away * 26), y: inY(k.b + 24) };
  const lowY = clampTo(k.b + 40 + c.exitT * (H - 40 - (k.b + 40)), p2.y, H - 30);
  let end: Pt;
  switch (c.exit) {
    case 'bottom': end = { x: clampTo(p2.x + (c.exitT - 0.5) * W * 0.6, 40, W - 40), y: H + OFF }; break;
    case 'bottom-left': end = { x: -OFF, y: H + OFF }; break;
    case 'bottom-right': end = { x: W + OFF, y: H + OFF }; break;
    case 'left': end = { x: -OFF, y: lowY }; break;
    case 'right': end = { x: W + OFF, y: lowY }; break;
  }
  return [p1, p2, end];
}

/** The planned quirks for one leg, as the rig takes them. */
function legQuirks(c: Choreography, leg: 'climb' | 'cross', from: Pt, path: Pt[], pointer?: () => Pt | null): Quirk[] {
  const len = pathLength(from, path);
  return c.quirks.filter((q) => q.leg === leg).map((q) => ({
    kind: q.kind, side: q.side, at: q.kind === 'tiptoe' ? Math.min(80, len * 0.4) : q.frac * len,
    ...(q.kind === 'lookAtPointer' && pointer ? { lookAt: pointer } : {}),
  }));
}

/**
 * Play one visit. Resolves after `done`, or as soon as `deps.signal` aborts (then nothing more is emitted).
 * Events: card-shown (only once the card is on screen), tick N … tick 1 a second apart, then either keep
 * (when Keep is clicked) or take (one second after tick 1), and done once Pockets has gone. If the card is not on
 * screen when the take is due (say the page opened a modal dialog over it), hidden is emitted instead of take and
 * the visit ends there, with no done; the same happens if the card has not come on screen within ten seconds of
 * the countdown phase starting. From play until card-shown (or hidden), alive is emitted every ten seconds so the
 * background's service worker is not stopped mid-climb; it stops on card-shown, on abort and when the visit ends.
 * With plan.resume (the background replays a paused visit), there is no climb: the countdown starts again from the full
 * length and card-shown is reported again once the card is on screen.
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
  const title = cleanTitle(plan.title);
  const text = { title: `Mine in ${total}…`, sub: `${title} · ${plan.reasonText}` };
  // Every random choice for the movement is drawn here, before any frame runs, so a seed always gives the same visit.
  const chor = planChoreography(rand, { reduced: deps.reduced, resume: !!plan.resume, reason: plan.reason, pointerKnown: !!deps.pointer?.() });
  const route = entranceRoute(chor, view, rand);
  const cross = crossRoute(route.side, tx, view, rand);
  let quoteTimer: ReturnType<typeof setTimeout> | undefined;
  const hush = (): void => {
    clearTimeout(quoteTimer);
    quoteTimer = undefined;
    deps.say?.(null);
  };
  signal.addEventListener('abort', hush, { once: true });

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
      if (!(await wait(REDUCED_HOLD_MS))) return;
      card.hide();
    } else {
      deps.setCarry({ phase: 'held' });
      if (!(await wait(REDUCED_HOLD_MS))) return;
    }
    deps.setVisible?.(false);
    deps.setCarry(null);
    out({ type: 'done' });
    return;
  }

  // A resumed visit (the user came back after a pause) skips the climb: Pockets is already under the tab, reaching up.
  const rig = deps.createRig(plan.resume ? { x: tx, y: 24 } : route.start, plan.resume ? -Math.PI / 2 : route.heading);
  deps.setVisible?.(true);
  // One travel() per leg, as in the mock. The rig's steering timeout scales with the path, so a long leg
  // on a big screen is not cut short; quirks ride along on the climb and crossing legs.
  const go = async (path: Pt[], speed: number, rest?: boolean, quirks?: Quirk[]): Promise<boolean> => {
    if (!live()) return false;
    const opts = rest === undefined && !quirks?.length ? undefined : { ...(rest === undefined ? {} : { rest }), ...(quirks?.length ? { quirks } : {}) };
    const arrived = await orAbort(rig.travel(path, speed, opts), false);
    return arrived && live();
  };

  if (!plan.resume) {
    // Poke the head in from the chosen edge, maybe say something, and look around.
    if (!(await go([route.peek], SPEED.peek, false))) return;
    if (chor.quote && deps.say) {
      deps.say(chor.quote);
      quoteTimer = setTimeout(hush, QUOTE_MS);
    }
    rig.setLook(true);
    if (!(await wait(LOOK_MS))) return;
    rig.setLook(false);

    // Climb the nearer border, then cross the top to under the target tab and turn up to it.
    if (!(await go(route.climb, SPEED.climb, undefined, legQuirks(chor, 'climb', route.peek, route.climb, deps.pointer)))) return;
    if (!(await go(cross, SPEED.climb, undefined, legQuirks(chor, 'cross', route.climb[route.climb.length - 1], cross, deps.pointer)))) return;
  }
  hush();
  rig.setReach(true);

  const outcome = await countdown(rig);
  if (outcome === 'cancelled') return;

  const exit = exitRoute(chor, tx, at, view);
  if (outcome === 'keep') {
    if (!(await wait(KEPT_MS))) return;
    card.hide();
    if (!(await go(exit, SPEED.leave))) return;
  } else {
    // The tab drops off the bar into Pockets' mouth; it crouches, springs and bolts off through the chosen edge.
    deps.setCarry({ phase: 'drop', from: { x: tx, y: -12 }, ms: DROP_MS });
    if (!(await wait(DROP_MS))) return;
    deps.setCarry({ phase: 'held' });
    rig.setStretch(CROUCH);
    if (!(await wait(CROUCH_MS))) return;
    rig.setStretch(SPRING);
    if (!(await go(exit, SPEED.bolt))) return;
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
      card.kept('Fine. Keep it.', `Pockets will leave ${title} alone for now.`);
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
