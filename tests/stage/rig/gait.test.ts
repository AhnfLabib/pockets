import { describe, it, expect } from 'vitest';
import { createFeet, footHome, stepGait, type BodyFrame, type Foot } from '../../../src/stage/rig/gait';

const DT = 1 / 60;
const mkRand = () => {
  let s = 7;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
};
// Body heads along +x; side is +y.
const frameAt = (x: number, y = 0): BodyFrame => ({ origin: { x, y }, fwd: { x: 1, y: 0 }, side: { x: 0, y: 1 } });

describe('gait', () => {
  it('keeps a planted foot still while its home is within threshold', () => {
    const rand = mkRand();
    const f = frameAt(0);
    const r = frameAt(-22);
    const feet = createFeet(f, r);
    const before = feet.map((x) => ({ ...x.pos }));
    for (let i = 0; i < 30; i++) stepGait(feet, f, r, 0, false, DT, rand);
    feet.forEach((x, i) => {
      expect(x.pos).toEqual(before[i]);
      expect(x.stepping).toBe(false);
    });
    // a small drift well under the threshold also leaves it planted
    const f2 = frameAt(5);
    const r2 = frameAt(-17);
    stepGait(feet, f2, r2, 60, false, DT, rand);
    feet.forEach((x, i) => expect(x.pos).toEqual(before[i]));
  });

  it('makes every foot step at least 5 times over 200 px of travel', () => {
    const rand = mkRand();
    let f = frameAt(0);
    let r = frameAt(-22);
    const feet = createFeet(f, r);
    const counts = [0, 0, 0, 0];
    const was = [false, false, false, false];
    for (let px = 1; px <= 200; px++) {
      f = frameAt(px);
      r = frameAt(px - 22);
      for (let k = 0; k < 1; k++) {
        stepGait(feet, f, r, 60, false, DT, rand);
        feet.forEach((x, i) => {
          if (x.stepping && !was[i]) counts[i]++;
          was[i] = x.stepping;
        });
      }
    }
    counts.forEach((c) => expect(c).toBeGreaterThanOrEqual(5));
  });

  it('never steps adjacent feet together but steps diagonal pair 0 and 3', () => {
    const rand = mkRand();
    let f = frameAt(0);
    let r = frameAt(-22);
    const feet = createFeet(f, r);
    const bad: [number, number][] = [[0, 1], [0, 2], [1, 3], [2, 3]];
    let diag = false;
    for (let i = 1; i <= 400; i++) {
      f = frameAt(i * 0.5);
      r = frameAt(i * 0.5 - 22);
      stepGait(feet, f, r, 30, false, DT, rand);
      for (const [a, b] of bad) expect(feet[a].stepping && feet[b].stepping).toBe(false);
      if (feet[0].stepping && feet[3].stepping) diag = true;
    }
    expect(diag).toBe(true);
  });

  it('snaps a foot more than 48 px from home straight to home', () => {
    const rand = mkRand();
    const f = frameAt(0);
    const r = frameAt(-22);
    const feet: Foot[] = createFeet(f, r);
    feet[2].pos = { x: 500, y: 500 };
    stepGait(feet, f, r, 0, false, DT, rand);
    expect(feet[2].pos).toEqual(footHome(2, f, r, false));
    expect(feet[2].stepping).toBe(false);
  });

  it('puts the front homes at least 10 px further forward when reaching', () => {
    const f = frameAt(0);
    const r = frameAt(-22);
    for (const i of [0, 1] as const) {
      const a = footHome(i, f, r, false);
      const b = footHome(i, f, r, true);
      expect(b.x - a.x).toBeGreaterThanOrEqual(10);
    }
  });
});
