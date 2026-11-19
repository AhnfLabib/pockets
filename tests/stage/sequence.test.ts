import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Rig } from '../../src/stage/rig/rig';
import type { Pt } from '../../src/stage/rig/chain';
import {
  BASE_SPEED, cardKeepOut, cardPosition, crossRoute, ENTRANCES, entranceRoute, estimateTabX, EXITS, exitRoute, planChoreography, runVisit, SPEED, TEMPO,
  type CardView, type Choreography, type Entrance, type Exit, type RigLike, type SequenceDeps,
} from '../../src/stage/sequence';
import { DISTRACTING_QUOTES, GENERAL_QUOTES, QUOTE_MS, RIFF_QUOTES } from '../../src/stage/quotes';
import type { VisitEvent, VisitPlan } from '../../src/shared/types';

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** mulberry32: well mixed from the first draw, unlike the LCG above, so small seeds give varied visits. */
function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

const chorFor = (seed: number, reason: 'stale' | 'distracting' = 'stale'): Choreography =>
  planChoreography(mulberry(seed), { reduced: false, reason });

/** The first seed whose visit matches `want` (the planner draws first, so this is what runVisit will play). */
function seedWhere(want: (c: Choreography) => boolean, from = 1): number {
  for (let seed = from; seed < from + 20_000; seed++) if (want(chorFor(seed))) return seed;
  throw new Error('no seed found');
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

  for (const [entrance, bx] of [['bottom-left', 30], ['left', 30], ['bottom-right', 970], ['right', 970]] as const) {
    it(`jitters the climb waypoints by at most 7 px around the border (${entrance}, x = ${bx})`, async () => {
      for (let n = 0; n < 6; n++) {
        const s = setup();
        s.deps.rand = mulberry(seedWhere((c) => c.entrance === entrance, 1 + n * 500));
        const p = runVisit(plan(), s.emit, s.deps);
        await vi.advanceTimersByTimeAsync(30_000);
        await p;
        s.stop();
        const climb = s.travels[1].filter((q) => q.y > 64);
        expect(climb.length).toBeGreaterThanOrEqual(entrance.startsWith('bottom') ? 3 : 2);
        for (const q of climb) expect(Math.abs(q.x - bx)).toBeLessThanOrEqual(7);
        expect(new Set(climb.map((q) => q.x)).size, 'jittered, not all equal').toBeGreaterThan(1);
      }
    });
  }
});

describe('runVisit on a large viewport with a moving rig', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** Run one visit with a moving rig; return the events, when card-shown and done came, the largest per-frame head
   *  move, the quirks that ran, and whether one was running at card-shown or after it. */
  async function movingVisit(seed: number, width: number, height: number, keep: boolean, tab = { tabIndex: 11, tabCount: 12 }) {
    const rigs: Rig[] = [];
    let maxStep = 0;
    let prev: Pt | null = null;
    let quirkAfterShown = false;
    let shown = false;
    let outside = false;
    const timer = setInterval(() => {
      for (const r of rigs) {
        r.update(1 / 60);
        const h = r.pose().nodes[0];
        if (prev) maxStep = Math.max(maxStep, Math.hypot(h.x - prev.x, h.y - prev.y));
        prev = { x: h.x, y: h.y };
        if (shown && r.quirking) quirkAfterShown = true;
      }
    }, 1000 / 60);
    const events: VisitEvent[] = [];
    const at: Record<string, number> = {};
    const t0 = Date.now();
    const card = fakeCard();
    const ac = new AbortController();
    const travels: Pt[][] = [];
    const p = runVisit(plan(tab), (e) => {
      events.push(e);
      at[e.type] ??= Date.now() - t0;
      if (e.type === 'card-shown') shown = true;
      if (keep && e.type === 'tick' && e.remaining === 2) card.pressKeep();
    }, {
      createRig: (start, heading) => {
        const r = new Rig({ start, heading, rand: mulberry(seed + 7) });
        const orig = r.travel.bind(r);
        r.travel = (path, speed, o) => { travels.push(path); return orig(path, speed, o); };
        rigs.push(r);
        return r;
      },
      card, view: { width, height }, reduced: false, rand: mulberry(seed), signal: ac.signal, setCarry: () => {},
      pointer: () => ({ x: width / 2, y: height / 2 }),
    });
    await vi.advanceTimersByTimeAsync(240_000);
    await p;
    clearInterval(timer);
    // Every waypoint but the exit's last stays inside the viewport.
    const flat = travels.slice(1).flatMap((t, i, all) => (i === all.length - 1 ? t.slice(0, -1) : t));
    for (const q of flat) if (q.x < 0 || q.x > width || q.y < 0 || q.y > height) outside = true;
    return { events: types(events), at, maxStep, quirks: rigs[0].quirkLog.slice(), quirkAfterShown, outside, travels };
  }

  /** Path length / speed for the legs before the card, plus the look and quirks: a generous expectation. */
  function expectedShownMs(c: Choreography, width: number, height: number, tx: number): number {
    const r = entranceRoute(c, { width, height }, () => 0.5);
    const cross = crossRoute(r.side, tx, { width }, () => 0.5);
    const len = (from: Pt, path: Pt[]) => path.reduce((a, q, i) => a + Math.hypot(q.x - (i ? path[i - 1] : from).x, q.y - (i ? path[i - 1] : from).y), 0);
    return 1000 * (len(r.start, [r.peek]) / SPEED.peek + 1 + (len(r.peek, r.climb) + len(r.climb.at(-1)!, cross)) / SPEED.climb + 1.5 * c.quirks.length);
  }

  // Each leg is one travel() call. The rig abandons a path by teleporting to its end once its per-path timeout
  // (2x the path at full speed, 2.6x when resting, at least 9 s) runs out. A jump would be hundreds of px; the bolt at 480 px/s
  // moves under 9 px a frame. card-shown must also come well before a timeout could have fired.
  for (const [w, h] of [[900, 440], [1920, 1080], [2560, 1440], [3840, 2160]]) {
    it(`never jumps at ${w}x${h}, for every entrance and exit, both endings, with quirks`, async () => {
      let seedFrom = 1;
      for (const entrance of ENTRANCES) {
        for (const exit of EXITS) {
          const seed = seedWhere((c) => c.entrance === entrance && c.exit === exit, seedFrom);
          seedFrom = seed + 1;
          const c = chorFor(seed, 'stale');
          for (const keep of [false, true]) {
            const label = `${entrance} -> ${exit} seed ${seed} keep ${keep}`;
            const r = await movingVisit(seed, w, h, keep);
            expect(r.events, label).toEqual(
              keep ? ['card-shown', 'tick 3', 'tick 2', 'keep', 'done'] : ['card-shown', 'tick 3', 'tick 2', 'tick 1', 'take', 'done'],
            );
            expect(r.maxStep, label).toBeLessThan(15);
            expect(r.quirks.length, label).toBeLessThanOrEqual(2);
            expect(r.quirkAfterShown, label).toBe(false);
            expect(r.outside, label).toBe(false);
            const tx = estimateTabX(11, 12, w);
            expect(r.at['card-shown'], label).toBeLessThan(expectedShownMs(c, w, h, tx) * 2.2 + 2000);
            const ex = exitRoute(c, tx, cardPosition(tx, w, false), { width: w, height: h });
            const exLen = ex.reduce((a, q, i) => a + Math.hypot(q.x - (i ? ex[i - 1] : { x: tx, y: 24 }).x, q.y - (i ? ex[i - 1] : { x: tx, y: 24 }).y), 0);
            expect(r.at.done - r.at['card-shown'], label).toBeLessThan(4000 + (1000 * exLen * (keep ? 2.2 : 1.6)) / (keep ? SPEED.leave : SPEED.bolt));
          }
        }
      }
    }, 300_000);
  }

  it('crosses to the first and the last tab from both borders without leaving the viewport', async () => {
    for (const entrance of ['bottom-left', 'bottom-right'] as const) {
      for (const tab of [{ tabIndex: 0, tabCount: 1 }, { tabIndex: 39, tabCount: 40 }]) {
        const seed = seedWhere((c) => c.entrance === entrance);
        const r = await movingVisit(seed, 1280, 720, false, tab);
        expect(r.events.at(-1), `${entrance} ${tab.tabIndex}`).toBe('done');
        expect(r.maxStep).toBeLessThan(15);
        expect(r.outside).toBe(false);
      }
    }
  }, 60_000);

  it('runs the planned quirks on the way up, never more than two, and none from card-shown on', async () => {
    let ran = 0;
    for (let seed = 1; seed <= 24; seed++) {
      const r = await movingVisit(seed, 1440, 900, false);
      const planned = chorFor(seed, 'stale').quirks.map((q) => q.kind);
      expect(r.quirks.length).toBeLessThanOrEqual(2);
      for (const k of r.quirks) expect(planned).toContain(k);
      expect(r.quirkAfterShown).toBe(false);
      ran += r.quirks.length;
    }
    expect(ran).toBeGreaterThan(5);
  }, 60_000);
});

describe('runVisit: quote and quirks', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  async function play(seed: number, o: { reduced?: boolean; reason?: 'stale' | 'distracting' } = {}) {
    const s = setup({ reduced: o.reduced });
    s.deps.rand = mulberry(seed);
    const said: { text: string | null; t: number }[] = [];
    const t0 = Date.now();
    const opts: unknown[] = [];
    s.deps.say = (text) => said.push({ text, t: Date.now() - t0 });
    s.deps.pointer = () => ({ x: 400, y: 300 });
    const create = s.deps.createRig;
    s.deps.createRig = (start, heading) => {
      const rig = create(start, heading);
      const tr = rig.travel;
      rig.travel = (path, speed, op) => { opts.push(op); return tr(path, speed, op); };
      return rig;
    };
    let shownAt = -1;
    const p = runVisit(plan({ reason: o.reason ?? 'stale' }), (e) => { s.emit(e); if (e.type === 'card-shown') shownAt = Date.now() - t0; }, s.deps);
    await vi.advanceTimersByTimeAsync(30_000);
    await p;
    s.stop();
    return { said, shownAt, opts: opts as ({ quirks?: { kind: string }[] } | undefined)[], events: types(s.events) };
  }

  it('says the planned line once Pockets is in, hides it within 2 s and before the card, on some seeds only', async () => {
    let with_ = 0;
    let without = 0;
    for (let seed = 1; seed <= 16; seed++) {
      const r = await play(seed);
      const quote = chorFor(seed, 'stale').quote;
      const texts = r.said.filter((x) => x.text !== null);
      if (quote === null) { without++; expect(texts).toEqual([]); continue; }
      with_++;
      expect(texts.map((x) => x.text)).toEqual([quote]);
      const hide = r.said.find((x) => x.text === null && x.t >= texts[0].t)!;
      expect(hide.t - texts[0].t).toBeLessThanOrEqual(QUOTE_MS);
      expect(hide.t).toBeLessThanOrEqual(r.shownAt);
      expect(r.events.at(-1)).toBe('done');
    }
    expect(with_).toBeGreaterThan(0);
    expect(without).toBeGreaterThan(0);
  });

  it('draws distracting visits from the distracting and riff lines', async () => {
    for (let seed = 1; seed <= 12; seed++) {
      const r = await play(seed, { reason: 'distracting' });
      for (const x of r.said) if (x.text !== null) expect([...DISTRACTING_QUOTES, ...RIFF_QUOTES]).toContain(x.text);
    }
  });

  it('never says anything or quirks in reduced motion', async () => {
    for (let seed = 1; seed <= 12; seed++) {
      const r = await play(seed, { reduced: true });
      expect(r.said.filter((x) => x.text !== null)).toEqual([]);
      expect(r.opts).toEqual([]);
    }
  });

  it('hands quirks only to the climb and crossing legs, 0-2 per visit, never to the peek or the exit', async () => {
    for (let seed = 1; seed <= 16; seed++) {
      const r = await play(seed);
      expect(r.opts).toHaveLength(4); // peek, climb, cross, exit
      const per = r.opts.map((o) => o?.quirks?.length ?? 0);
      expect(per[0]).toBe(0);
      expect(per[3]).toBe(0);
      expect(per[1] + per[2]).toBe(chorFor(seed, 'stale').quirks.length);
      expect(per[1] + per[2]).toBeLessThanOrEqual(2);
    }
  });
});

describe('planChoreography', () => {
  it('hits every entrance and exit kind over seeded runs, and the same seed gives the same visit', () => {
    const entrances = new Set<Entrance>();
    const exits = new Set<Exit>();
    for (let seed = 1; seed <= 200; seed++) {
      const c = chorFor(seed);
      entrances.add(c.entrance);
      exits.add(c.exit);
      expect(chorFor(seed)).toEqual(c);
    }
    expect([...entrances].sort()).toEqual([...ENTRANCES].sort());
    expect([...exits].sort()).toEqual([...EXITS].sort());
  });

  it('plans 0 to 2 distinct quirks and all three counts occur', () => {
    const counts = new Set<number>();
    const kinds = new Set<string>();
    for (let seed = 1; seed <= 300; seed++) {
      {
        const c = chorFor(seed, 'stale');
        expect(c.quirks.length).toBeLessThanOrEqual(2);
        expect(new Set(c.quirks.map((q) => q.kind)).size).toBe(c.quirks.length);
        for (const q of c.quirks) {
          kinds.add(q.kind);
          if (q.kind === 'tiptoe') expect(q.leg).toBe('cross');
          else { expect(q.frac).toBeGreaterThanOrEqual(0.15); expect(q.frac).toBeLessThanOrEqual(0.8); }
        }
        counts.add(c.quirks.length);
      }
    }
    expect([...counts].sort()).toEqual([0, 1, 2]);
    expect(kinds.size).toBe(8);
  });

  it('plans no quirks and no quote in reduced motion or on a resume', () => {
    for (let seed = 1; seed <= 100; seed++) {
      for (const o of [{ reduced: true }, { reduced: false, resume: true }]) {
        const c = planChoreography(mulberry(seed), { ...o, reason: 'distracting' });
        expect(c.quirks).toEqual([]);
        expect(c.quote).toBeNull();
      }
    }
  });

  it('quotes on about half of visits, from the general and riff lines, and the distracting and riff lines for distracting tabs', () => {
    let some = 0;
    let none = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const stale = chorFor(seed, 'stale').quote;
      const dis = chorFor(seed, 'distracting').quote;
      if (stale === null) none++; else some++;
      if (stale !== null) expect([...GENERAL_QUOTES, ...RIFF_QUOTES]).toContain(stale);
      if (dis !== null) {
        expect([...DISTRACTING_QUOTES, ...RIFF_QUOTES]).toContain(dis);
        expect(GENERAL_QUOTES).not.toContain(dis);
      }
    }
    expect(some / 400).toBeGreaterThan(0.35);
    expect(some / 400).toBeLessThan(0.65);
    expect(none).toBeGreaterThan(0);
  });
});

describe('routes', () => {
  /** Whether segment a-b passes through the box. */
  function hits(a: Pt, b: Pt, k: { l: number; t: number; r: number; b: number }): boolean {
    for (let i = 0; i <= 200; i++) {
      const x = a.x + ((b.x - a.x) * i) / 200;
      const y = a.y + ((b.y - a.y) * i) / 200;
      if (x > k.l && x < k.r && y > k.t && y < k.b) return true;
    }
    return false;
  }

  it('exit routes never cross the card, keep inside the viewport until the last point, and end off the page', () => {
    for (const [w, h] of [[900, 440], [1280, 720], [1920, 1080], [3840, 2160]]) {
      for (const count of [1, 3, 12, 40]) {
        for (let i = 0; i < count; i++) {
          const tx = estimateTabX(i, count, w);
          const at = cardPosition(tx, w, false);
          // The card may sit right or (near the right edge) left of Pockets: the route must avoid it either way.
          const k = cardKeepOut(at, w);
          for (const exit of EXITS) {
            for (const exitT of [0, 0.5, 1]) {
              const c: Choreography = { entrance: 'left', edgeY: 0.7, exit, exitT, quirks: [], quote: null };
              const path = exitRoute(c, tx, at, { width: w, height: h });
              const label = `${w}x${h} tab ${i}/${count} ${exit} ${exitT}`;
              let prev: Pt = { x: tx, y: 24 };
              for (const q of path) { expect(hits(prev, q, { ...k, l: k.l + 4, r: k.r - 4 }), label).toBe(false); prev = q; }
              for (const q of path.slice(0, -1)) {
                expect(q.x, label).toBeGreaterThanOrEqual(0); expect(q.x, label).toBeLessThanOrEqual(w);
                expect(q.y, label).toBeGreaterThanOrEqual(0); expect(q.y, label).toBeLessThanOrEqual(h);
              }
              const end = path.at(-1)!;
              expect(end.x < -100 || end.x > w + 100 || end.y > h + 100, label).toBe(true);
              if (exit === 'left' || exit.endsWith('left')) expect(end.x, label).toBeLessThan(0);
              if (exit === 'right' || exit.endsWith('right')) expect(end.x, label).toBeGreaterThan(w);
              if (exit.startsWith('bottom')) expect(end.y, label).toBeGreaterThan(h);
            }
          }
        }
      }
    }
  });

  it('entrances poke in from their edge and climb the nearer border', () => {
    const view = { width: 1200, height: 800 };
    for (const entrance of ENTRANCES) {
      for (const edgeY of [0.55, 0.88]) {
        const r = entranceRoute({ entrance, edgeY, exit: 'bottom', exitT: 0, quirks: [], quote: null }, view, mulberry(3));
        const left = entrance.endsWith('left');
        expect(r.side).toBe(left ? 'left' : 'right');
        if (entrance.startsWith('bottom')) {
          expect(r.start.y).toBeGreaterThan(800);
          expect(r.peek.y).toBeGreaterThan(780);
        } else {
          expect(left ? r.start.x : 1200 - r.start.x).toBeLessThan(0);
          expect(left ? r.peek.x : 1200 - r.peek.x).toBeLessThan(12);
          expect(r.peek.y).toBeGreaterThanOrEqual(400); // lower half
        }
        expect(r.climb.at(-1)).toEqual({ x: left ? 32 : 1168, y: 64 });
        for (const q of r.climb) expect(Math.abs(q.x - (left ? 30 : 1170))).toBeLessThanOrEqual(7);
      }
    }
  });
});

describe('tempo', () => {
  it('runs every choreography speed TEMPO (1.2) times the mock', () => {
    expect(TEMPO).toBe(1.2);
    for (const k of ['peek', 'climb', 'leave', 'bolt'] as const) expect(SPEED[k]).toBeCloseTo(BASE_SPEED[k] * 1.2, 9);
  });

  it('a travel at the new speed arrives in at most 1/1.2 of the old time (+5%)', () => {
    for (const k of ['peek', 'climb', 'leave', 'bolt'] as const) {
      const time = (speed: number): number => {
        const r = new Rig({ start: { x: 0, y: 0 }, heading: 0, rand: mulberry(5) });
        void r.travel([{ x: 400, y: 10 }, { x: 900, y: 40 }], speed, { rest: false });
        let t = 0;
        const at = (): boolean => { const h = r.pose().nodes[0]; return Math.hypot(h.x - 900, h.y - 40) < 0.01; };
        while (!at() && t < 60) { r.update(1 / 60); t += 1 / 60; }
        return t;
      };
      const before = time(BASE_SPEED[k]);
      const after = time(SPEED[k]);
      expect(after, k).toBeLessThanOrEqual((before / 1.2) * 1.05);
    }
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
