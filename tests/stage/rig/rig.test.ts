import { describe, it, expect } from 'vitest';
import { Rig } from '../../../src/stage/rig/rig';
import { LINKS } from '../../../src/stage/rig/chain';

const DT = 1 / 60;
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const mk = (seed = 1, still = false) =>
  new Rig({ start: { x: 0, y: 0 }, heading: 0, rand: seeded(seed), still });

describe('rig', () => {
  it('travel resolves; head ends within 3.5 px and no link is stretched', async () => {
    const r = mk();
    let done = false;
    const p = r.travel([{ x: 100, y: 0 }], 150).then(() => { done = true; });
    for (let i = 0; i < 60 * 12 && !done; i++) {
      r.update(DT);
      await Promise.resolve();
    }
    await p;
    expect(done).toBe(true);
    const n = r.pose().nodes;
    expect(Math.hypot(n[0].x - 100, n[0].y)).toBeLessThanOrEqual(3.5);
    for (let i = 1; i < n.length; i++) {
      const l = Math.hypot(n[i].x - n[i - 1].x, n[i].y - n[i - 1].y);
      expect(Math.abs(l - LINKS[i])).toBeLessThan(1e-6);
    }
  });

  it('setStretch eases toward the target rather than jumping', () => {
    const r = mk();
    const s0 = r.pose().stretch;
    r.setStretch(0.74);
    r.update(DT);
    const s1 = r.pose().stretch;
    expect(s1).toBeLessThan(s0);
    expect(s1).toBeGreaterThan(0.74);
    for (let i = 0; i < 120; i++) r.update(DT);
    expect(r.pose().stretch).toBeCloseTo(0.74, 2);
  });

  it('same seed gives identical poses after 500 steps', () => {
    const run = () => {
      const r = mk(7);
      void r.travel([{ x: 200, y: 80 }, { x: 40, y: 120 }], 180);
      for (let i = 0; i < 500; i++) r.update(DT);
      return r.pose();
    };
    expect(run()).toEqual(run());
  });

  it('still: travel resolves on the next update, head at the last waypoint', async () => {
    const r = mk(1, true);
    let done = false;
    void r.travel([{ x: 50, y: 0 }, { x: 300, y: 40 }], 150).then(() => { done = true; });
    await Promise.resolve();
    expect(done).toBe(false);
    r.update(DT);
    await Promise.resolve();
    expect(done).toBe(true);
    const h = r.pose().nodes[0];
    expect(h.x).toBeCloseTo(300);
    expect(h.y).toBeCloseTo(40);
  });

  it('travel([]) stops the rig and resolves the in-flight promise false', async () => {
    const r = mk();
    let first: boolean | undefined;
    void r.travel([{ x: 500, y: 0 }], 150).then((v) => { first = v; });
    for (let i = 0; i < 30; i++) r.update(DT);
    const stopped = await r.travel([], 150);
    expect(stopped).toBe(true);
    expect(first).toBe(false);
    for (let i = 0; i < 30; i++) r.update(DT); // let speed bleed off
    const h0 = r.pose().nodes[0];
    for (let i = 0; i < 60; i++) r.update(DT);
    const h1 = r.pose().nodes[0];
    expect(h1).toEqual(h0);
  });

  it('a superseded travel resolves false; the new one resolves true on arrival', async () => {
    const r = mk();
    let a: boolean | undefined, b: boolean | undefined;
    void r.travel([{ x: 400, y: 0 }], 150).then((v) => { a = v; });
    for (let i = 0; i < 20; i++) r.update(DT);
    void r.travel([{ x: 60, y: 30 }], 150).then((v) => { b = v; });
    for (let i = 0; i < 60 * 12 && b === undefined; i++) {
      r.update(DT);
      await Promise.resolve();
    }
    expect(a).toBe(false);
    expect(b).toBe(true);
  });

  it('pose() returns copies of the feet', () => {
    const r = mk();
    const p = r.pose();
    const x = p.feet[0].pos.x;
    p.feet[0].pos.x += 100;
    p.feet[0].from.x += 100;
    p.feet[0].to.x += 100;
    p.feet[0].stepping = true;
    const q = r.pose();
    expect(q.feet[0].pos.x).toBe(x);
    expect(q.feet[0].stepping).toBe(false);
    expect(q.feet[0].from.x).not.toBe(p.feet[0].from.x);
    expect(q.feet[0].to.x).not.toBe(p.feet[0].to.x);
  });
});
