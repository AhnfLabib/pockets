import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Rig } from '../../src/stage/rig/rig';
import type { Pt } from '../../src/stage/rig/chain';
import { estimateTabX, runVisit, type CardView, type SequenceDeps } from '../../src/stage/sequence';
import type { VisitEvent, VisitPlan } from '../../src/shared/types';

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const plan = (over: Partial<VisitPlan> = {}): VisitPlan => ({
  visitId: 'v1', targetTabId: 7, title: 'YouTube', reason: 'stale', reasonText: 'not opened for 2 days',
  tabIndex: 2, tabCount: 5, countdownSeconds: 3, targetIsStage: false, ...over,
});

interface FakeCard extends CardView {
  shownAt: { left: number; top: number } | null;
  pressKeep(): void;
  log: string[];
}

function fakeCard(): FakeCard {
  let keep: (() => void) | null = null;
  const card: FakeCard = {
    shownAt: null,
    log: [],
    show(at, _text, onKeep) {
      card.shownAt = at;
      keep = onKeep;
      card.log.push('show');
      return Promise.resolve(true);
    },
    count(n) { card.log.push(`count ${n}`); },
    kept() { card.log.push('kept'); },
    hide() { card.log.push('hide'); },
    pressKeep() { keep?.(); },
  };
  return card;
}

/** A still Rig driven at 60 fps by fake timers, as the stage's frame loop would. */
function setup(opts: { reduced?: boolean } = {}) {
  const rigs: Rig[] = [];
  const travels: Pt[][] = [];
  const card = fakeCard();
  const events: VisitEvent[] = [];
  const ac = new AbortController();
  const timer = setInterval(() => rigs.forEach((r) => r.update(1 / 60)), 16);
  const deps: SequenceDeps = {
    createRig(start, heading) {
      const rig = new Rig({ start, heading, rand: seeded(3), still: true });
      const orig = rig.travel.bind(rig);
      rig.travel = vi.fn((path: Pt[], speed: number, o?: { rest?: boolean }) => {
        travels.push(path);
        return orig(path, speed, o);
      });
      rigs.push(rig);
      return rig;
    },
    card,
    view: { width: 1000, height: 700 },
    reduced: !!opts.reduced,
    rand: seeded(11),
    signal: ac.signal,
    setCarry: () => {},
  };
  return { deps, card, events, travels, ac, stop: () => clearInterval(timer), emit: (e: VisitEvent) => events.push(e) };
}

const types = (events: VisitEvent[]): string[] =>
  events.map((e) => (e.type === 'tick' ? `tick ${e.remaining}` : e.type));

describe('runVisit', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('emits card-shown, tick 3, tick 2, tick 1, take, done for an untouched countdown of 3', async () => {
    const s = setup();
    let resolved = false;
    const p = runVisit(plan(), s.emit, s.deps).then(() => { resolved = true; });
    await vi.advanceTimersByTimeAsync(30_000);
    await p;
    s.stop();
    expect(resolved).toBe(true);
    expect(types(s.events)).toEqual(['card-shown', 'tick 3', 'tick 2', 'tick 1', 'take', 'done']);
    expect(s.travels.length).toBeGreaterThan(0);
  });

  it('spaces the ticks one second apart and takes one second after the last tick', async () => {
    const s = setup();
    const at: Record<string, number> = {};
    const t0 = Date.now();
    void runVisit(plan(), (e) => { at[e.type === 'tick' ? `tick ${e.remaining}` : e.type] = Date.now() - t0; }, s.deps);
    await vi.advanceTimersByTimeAsync(30_000);
    s.stop();
    expect(at['tick 3'] - at['card-shown']).toBeLessThan(20);
    expect(at['tick 2'] - at['tick 3']).toBe(1000);
    expect(at['tick 1'] - at['tick 2']).toBe(1000);
    expect(at.take - at['tick 1']).toBe(1000);
  });

  it('yields keep, done and never take when Keep is clicked after tick 2', async () => {
    const s = setup();
    const p = runVisit(plan(), (e) => {
      s.emit(e);
      if (e.type === 'tick' && e.remaining === 2) setTimeout(() => s.card.pressKeep(), 300);
    }, s.deps);
    await vi.advanceTimersByTimeAsync(30_000);
    await p;
    s.stop();
    expect(types(s.events)).toEqual(['card-shown', 'tick 3', 'tick 2', 'keep', 'done']);
    expect(s.card.log).toContain('kept');
  });

  it('puts the card at the top left (left edge <= 16 px) and never travels with reduced motion', async () => {
    const s = setup({ reduced: true });
    const p = runVisit(plan(), s.emit, s.deps);
    await vi.advanceTimersByTimeAsync(30_000);
    await p;
    s.stop();
    expect(s.card.shownAt).not.toBeNull();
    expect(s.card.shownAt!.left).toBeLessThanOrEqual(16);
    expect(s.travels).toHaveLength(0);
    expect(types(s.events)).toEqual(['card-shown', 'tick 3', 'tick 2', 'tick 1', 'take', 'done']);
  });

  it('emits nothing more and resolves once aborted mid-countdown', async () => {
    const s = setup();
    let resolved = false;
    const p = runVisit(plan(), (e) => {
      s.emit(e);
      if (e.type === 'tick' && e.remaining === 2) s.ac.abort();
    }, s.deps);
    void p.then(() => { resolved = true; });
    await vi.advanceTimersByTimeAsync(30_000);
    s.stop();
    expect(resolved).toBe(true);
    expect(types(s.events)).toEqual(['card-shown', 'tick 3', 'tick 2']);
  });

  it('jitters the three climb waypoints by at most 7 px around x = 30', async () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const s = setup();
      s.deps.rand = seeded(seed);
      const p = runVisit(plan(), s.emit, s.deps);
      await vi.advanceTimersByTimeAsync(30_000);
      await p;
      s.stop();
      const climb = s.travels.flat().filter((q) => q.y > 64 && q.y < 700 * 0.8 && q.x < 45);
      expect(climb.length).toBeGreaterThanOrEqual(3);
      for (const q of climb) expect(Math.abs(q.x - 30)).toBeLessThanOrEqual(7);
    }
  });
});

describe('runVisit on a large viewport with a moving rig', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('never jumps (no 9 s steering timeout) climbing 1080 px and crossing to the last tab at 1920 px', async () => {
    const rigs: Rig[] = [];
    let maxStep = 0;
    let prev: Pt | null = null;
    const timer = setInterval(() => {
      for (const r of rigs) {
        r.update(1 / 60);
        const h = r.pose().nodes[0];
        if (prev) maxStep = Math.max(maxStep, Math.hypot(h.x - prev.x, h.y - prev.y));
        prev = { x: h.x, y: h.y };
      }
    }, 1000 / 60);
    const events: VisitEvent[] = [];
    const ac = new AbortController();
    const p = runVisit(plan({ tabIndex: 11, tabCount: 12 }), (e) => events.push(e), {
      createRig: (start, heading) => {
        const r = new Rig({ start, heading, rand: seeded(5) });
        rigs.push(r);
        return r;
      },
      card: fakeCard(), view: { width: 1920, height: 1080 }, reduced: false, rand: seeded(9), signal: ac.signal, setCarry: () => {},
    });
    await vi.advanceTimersByTimeAsync(90_000);
    await p;
    clearInterval(timer);
    expect(types(events)).toEqual(['card-shown', 'tick 3', 'tick 2', 'tick 1', 'take', 'done']);
    // The bolt runs at 400 px/s: under 7 px a frame. A timeout teleport would jump hundreds of px.
    expect(maxStep).toBeLessThan(15);
  });
});

describe('estimateTabX', () => {
  it('puts the first of one tab in the left quarter and the last of ten in the right quarter', () => {
    expect(estimateTabX(0, 1, 1000)).toBeLessThanOrEqual(250);
    expect(estimateTabX(9, 10, 1000)).toBeGreaterThanOrEqual(750);
  });

  it('always clamps to [60, width - 40]', () => {
    for (const w of [200, 320, 800, 1000, 1440, 1920, 3000]) {
      for (const count of [1, 2, 5, 10, 40]) {
        for (let i = 0; i < count; i++) {
          const x = estimateTabX(i, count, w);
          expect(x).toBeGreaterThanOrEqual(60);
          expect(x).toBeLessThanOrEqual(w - 40);
        }
      }
    }
  });

  it('moves right as the index grows', () => {
    const xs = [0, 1, 2, 3, 4].map((i) => estimateTabX(i, 5, 1200));
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThan(xs[i - 1]);
  });
});
