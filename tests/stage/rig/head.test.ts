import { describe, it, expect } from 'vitest';
import { stepHead, type Head } from '../../../src/stage/rig/head';

const DT = 1 / 60;
const fresh = (): Head => ({ angle: 0, vel: 0, gaze: 0, gazeTimer: 0, eye: 0, sniff: 0, ear: 0, blink: false });

describe('head', () => {
  it('settles within 0.02 of a 0.7 gaze inside 1 s and overshoots it', () => {
    const h = fresh();
    let over = false, t = 0;
    for (let i = 0; i < 60; i++) {
      t += DT;
      stepHead(h, 'look', 0, 0, DT, t, () => 1); // rand 1 => gaze = 0.7 every pick
      if (h.angle > 0.7) over = true;
    }
    expect(Math.abs(h.angle - 0.7)).toBeLessThan(0.02);
    expect(over).toBe(true);
  });

  it('eyes lead: eye has the sign of (target - angle) when the gaze changes', () => {
    const h = fresh();
    stepHead(h, 'look', 0, 0, DT, DT, () => 1);
    expect(h.gaze).toBeCloseTo(0.7);
    expect(h.eye).toBeGreaterThan(0);
    const g = fresh();
    stepHead(g, 'look', 0, 0, DT, DT, () => 0);
    expect(g.eye).toBeLessThan(0);
  });

  it('in reach mode gaze is only within [-0.15, 0.15] or exactly 0.8', () => {
    const h = fresh();
    let s = 12345;
    const rand = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    const seen = new Set<number>();
    let t = 0;
    for (let i = 0; i < 3000; i++) {
      t += DT;
      stepHead(h, 'reach', 0, 0, DT, t, rand);
      seen.add(h.gaze);
    }
    for (const g of seen) expect(g === 0.8 || Math.abs(g) <= 0.15).toBe(true);
    expect(seen.has(0.8)).toBe(true);
  });
});
