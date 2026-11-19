import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Rig } from '../../src/stage/rig/rig';
import type { Pt } from '../../src/stage/rig/chain';
import { estimateTabX, runVisit, type CardView, type RigLike, type SequenceDeps } from '../../src/stage/sequence';
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
  /** What visible() answers (the pre-take re-check). */
  onScreen: boolean;
  pressKeep(): void;
  log: string[];
}

function fakeCard(): FakeCard {
  let keep: (() => void) | null = null;
  const card: FakeCard = {
    shownAt: null,
    onScreen: true,
    log: [],
    show(at, _text, onKeep) {
      card.shownAt = at;
      keep = onKeep;
      card.log.push('show');
      return Promise.resolve(true);
    },
    visible() { return card.onScreen; },
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

/** Every event, alive included. */
const allTypes = (events: VisitEvent[]): string[] =>
  events.map((e) => (e.type === 'tick' ? `tick ${e.remaining}` : e.type));
/** The choreography: the keep-awake alive pings (every 10 s until card-shown) are left out; they have their own tests. */
const types = (events: VisitEvent[]): string[] => allTypes(events).filter((t) => t !== 'alive');

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

  it('resume: no climb; Pockets starts under the tab, the card is confirmed again and the full countdown runs', async () => {
    const s = setup();
    const starts: Pt[] = [];
    const create = s.deps.createRig;
    s.deps.createRig = (start, heading) => { starts.push(start); return create(start, heading); };
    const t0 = Date.now();
    const at: Record<string, number> = {};
    const p = runVisit(plan({ resume: true }), (e) => { s.emit(e); at[e.type === 'tick' ? `tick ${e.remaining}` : e.type] ??= Date.now() - t0; }, s.deps);
    await vi.advanceTimersByTimeAsync(30_000);
    await p;
    s.stop();
    expect(types(s.events)).toEqual(['card-shown', 'tick 3', 'tick 2', 'tick 1', 'take', 'done']);
    expect(starts).toEqual([{ x: estimateTabX(2, 5, 1000), y: 24 }]);
    expect(at['card-shown']).toBeLessThan(200); // no peek, look or climb before the card
    expect(s.card.log[0]).toBe('show');
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

  it('emits hidden instead of take, and no done, when the card is not on screen as the take is due', async () => {
    const s = setup();
    let resolved = false;
    const p = runVisit(plan(), (e) => {
      s.emit(e);
      if (e.type === 'tick' && e.remaining === 1) s.card.onScreen = false;
    }, s.deps).then(() => { resolved = true; });
    await vi.advanceTimersByTimeAsync(30_000);
    await p;
    s.stop();
    expect(resolved).toBe(true);
    expect(types(s.events)).toEqual(['card-shown', 'tick 3', 'tick 2', 'tick 1', 'hidden']);
    expect(s.card.log.at(-1)).toBe('hide');
  });

  it('emits hidden instead of take with reduced motion too', async () => {
    const s = setup({ reduced: true });
    const p = runVisit(plan(), (e) => {
      s.emit(e);
      if (e.type === 'tick' && e.remaining === 2) s.card.onScreen = false;
    }, s.deps);
    await vi.advanceTimersByTimeAsync(30_000);
    await p;
    s.stop();
    expect(types(s.events)).toEqual(['card-shown', 'tick 3', 'tick 2', 'tick 1', 'hidden']);
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

  it('resolves with no card-shown and no further events when aborted while the card can never show', async () => {
    // Models a hidden tab: requestAnimationFrame never fires, so the card's show() never settles by itself.
    const s = setup();
    let showCalled = false;
    s.deps.card.show = () => { showCalled = true; return new Promise<boolean>(() => {}); };
    let resolved = false;
    const p = runVisit(plan(), s.emit, s.deps).then(() => { resolved = true; });
    while (!showCalled) await vi.advanceTimersByTimeAsync(100); // climb done, stuck at show()
    await vi.advanceTimersByTimeAsync(5_000); // inside the 10 s show window
    expect(resolved).toBe(false);
    const before = s.events.length;
    s.ac.abort();
    await vi.advanceTimersByTimeAsync(60_000);
    s.stop();
    expect(resolved).toBe(true);
    await p;
    expect(types(s.events)).toEqual([]);
    expect(s.events.length, 'nothing at all after the abort, not even alive').toBe(before);
  });

  it('resolves promptly when aborted mid-travel even if the rig never answers', async () => {
    const s = setup();
    const create = s.deps.createRig;
    s.deps.createRig = (start, heading) => {
      const rig = create(start, heading);
      rig.travel = () => new Promise<boolean>(() => {});
      return rig;
    };
    let resolved = false;
    void runVisit(plan(), s.emit, s.deps).then(() => { resolved = true; });
    await vi.advanceTimersByTimeAsync(1000);
    s.ac.abort();
    await vi.advanceTimersByTimeAsync(10);
    s.stop();
    expect(resolved).toBe(true);
    expect(s.events).toEqual([]);
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

  /** Run one visit with a moving rig; return the events and the largest per-frame head move. */
  async function movingVisit(seed: number, width: number, height: number, keep: boolean) {
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
    const card = fakeCard();
    const ac = new AbortController();
    const p = runVisit(plan({ tabIndex: 11, tabCount: 12 }), (e) => {
      events.push(e);
      if (keep && e.type === 'tick' && e.remaining === 2) card.pressKeep();
    }, {
      createRig: (start, heading) => {
        const r = new Rig({ start, heading, rand: seeded(seed) });
        rigs.push(r);
        return r;
      },
      card, view: { width, height }, reduced: false, rand: seeded(seed + 1000), signal: ac.signal, setCarry: () => {},
    });
    await vi.advanceTimersByTimeAsync(180_000);
    await p;
    clearInterval(timer);
    return { events: types(events), maxStep };
  }

  // Each leg is one travel() call. The rig abandons a path by teleporting to its end once its per-path timeout
  // (2x the path at full speed, at least 9 s) runs out. A jump would be hundreds of px; the bolt at 400 px/s
  // moves under 7 px a frame.
  for (const [w, h] of [[1920, 1080], [2560, 1440], [3840, 2160]]) {
    it(`never jumps at ${w}x${h}, crossing to the last tab, over 30 seeds and both endings`, async () => {
      for (let seed = 1; seed <= 30; seed++) {
        for (const keep of [false, true]) {
          const r = await movingVisit(seed, w, h, keep);
          expect(r.events, `seed ${seed} keep ${keep}`).toEqual(
            keep ? ['card-shown', 'tick 3', 'tick 2', 'keep', 'done'] : ['card-shown', 'tick 3', 'tick 2', 'tick 1', 'take', 'done'],
          );
          expect(r.maxStep, `seed ${seed} keep ${keep}`).toBeLessThan(15);
        }
      }
    }, 120_000);
  }
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

describe('runVisit keep-awake (alive)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** A rig whose climb leg (the second travel) takes `climbMs`; every other leg arrives at once. */
  function slowRig(climbMs: number, arrive = true): RigLike {
    let n = 0;
    return {
      travel: () => new Promise<boolean>((res) => { n++; const climb = n === 2; setTimeout(() => res(climb ? arrive : true), climb ? climbMs : 0); }),
      setLook() {}, setReach() {}, setStretch() {},
    };
  }

  function run(rig: RigLike) {
    const s = setup();
    s.deps.createRig = () => rig;
    const at: { type: string; t: number }[] = [];
    const t0 = Date.now();
    let resolved = false;
    const p = runVisit(plan(), (e) => { s.emit(e); at.push({ type: e.type, t: Date.now() - t0 }); }, s.deps).then(() => { resolved = true; });
    return { s, at, p, resolved: () => resolved };
  }

  it('emits alive every 10 s from play start during a long climb, and stops after card-shown', async () => {
    const r = run(slowRig(45_000));
    await vi.advanceTimersByTimeAsync(120_000);
    await r.p;
    r.s.stop();
    const shownAt = r.at.find((e) => e.type === 'card-shown')!.t;
    expect(shownAt).toBeGreaterThan(45_000);
    const alive = r.at.filter((e) => e.type === 'alive').map((e) => e.t);
    expect(alive).toEqual([10_000, 20_000, 30_000, 40_000]);
    expect(alive.every((t) => t < shownAt)).toBe(true);
    expect(allTypes(r.s.events).slice(-6)).toEqual(['card-shown', 'tick 3', 'tick 2', 'tick 1', 'take', 'done']);
  });

  it('stops on cancel', async () => {
    const r = run(slowRig(45_000));
    await vi.advanceTimersByTimeAsync(25_000);
    expect(allTypes(r.s.events)).toEqual(['alive', 'alive']);
    r.s.ac.abort();
    await vi.advanceTimersByTimeAsync(60_000);
    r.s.stop();
    expect(r.resolved()).toBe(true);
    expect(allTypes(r.s.events)).toEqual(['alive', 'alive']);
  });

  it('stops when the visit ends early without an abort (a leg that does not arrive)', async () => {
    const r = run(slowRig(15_000, false));
    await vi.advanceTimersByTimeAsync(120_000);
    r.s.stop();
    expect(r.resolved()).toBe(true);
    expect(allTypes(r.s.events)).toEqual(['alive']);
  });

  it('a short visit sends no alive at all', async () => {
    const r = run(slowRig(0));
    await vi.advanceTimersByTimeAsync(120_000);
    await r.p;
    r.s.stop();
    expect(allTypes(r.s.events)).toEqual(['card-shown', 'tick 3', 'tick 2', 'tick 1', 'take', 'done']);
  });
});

describe('runVisit: the card never comes on screen', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  for (const reduced of [false, true]) {
    it(`emits hidden 10 s after the countdown phase starts, with no card-shown, take or done (reduced ${reduced})`, async () => {
      const s = setup({ reduced });
      let showAt = -1;
      const t0 = Date.now();
      s.deps.card.show = () => { showAt = Date.now() - t0; return new Promise<boolean>(() => {}); };
      const at: { type: string; t: number }[] = [];
      let resolved = false;
      const p = runVisit(plan(), (e) => { s.emit(e); at.push({ type: e.type, t: Date.now() - t0 }); }, s.deps)
        .then(() => { resolved = true; });
      await vi.advanceTimersByTimeAsync(120_000);
      s.stop();
      expect(resolved).toBe(true);
      await p;
      expect(types(s.events)).toEqual(['hidden']);
      const hidden = at.find((e) => e.type === 'hidden')!;
      expect(hidden.t - showAt).toBe(10_000);
      // alive stops with hidden: none after it.
      expect(at.filter((e) => e.type === 'alive' && e.t > hidden.t)).toEqual([]);
      expect(s.card.log.at(-1)).toBe('hide');
    });
  }

  it('alive pings during a long wait stop at hidden', async () => {
    const s = setup();
    const t0 = Date.now();
    s.deps.card.show = () => new Promise<boolean>(() => {});
    const at: { type: string; t: number }[] = [];
    void runVisit(plan(), (e) => { at.push({ type: e.type, t: Date.now() - t0 }); }, s.deps);
    await vi.advanceTimersByTimeAsync(120_000);
    s.stop();
    const hidden = at.find((e) => e.type === 'hidden')!.t;
    expect(at.filter((e) => e.type === 'alive').every((e) => e.t < hidden)).toBe(true);
    expect(at.at(-1)!.type).toBe('hidden');
  });
});
