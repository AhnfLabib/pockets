import { describe, it, expect } from 'vitest';
import { createSteer, stepSteer } from '../../../src/stage/rig/steer';

const DT = 1 / 60;
const rand = () => 0.5;

function run(rest: boolean, base = 150) {
  const s = createSteer(0);
  const head = { x: 0, y: 0 };
  const goal = { x: 300, y: 0 };
  s.path = [{ ...goal }];
  s.base = base;
  s.rest = rest;
  const speeds: number[] = [];
  const times: number[] = [];
  let prev = s.speed, maxJump = 0, now = 0, arrived = false;
  while (now < 20 && !arrived) {
    now += DT;
    const r = stepSteer(s, head, DT, now, rand);
    maxJump = Math.max(maxJump, Math.abs(s.speed - prev));
    prev = s.speed;
    speeds.push(s.speed);
    times.push(now);
    arrived = r.arrived;
  }
  return { head, goal, speeds, times, now, arrived, maxJump };
}

describe('steer', () => {
  it('arrives at a waypoint 300 px away in under 6 s, within 3.5 px', () => {
    const r = run(true);
    expect(r.arrived).toBe(true);
    expect(r.now).toBeLessThan(6);
    expect(Math.hypot(r.head.x - r.goal.x, r.head.y - r.goal.y)).toBeLessThanOrEqual(3.5);
  });

  it('pauses (speed 0) before arrival when rest is true', () => {
    const r = run(true);
    const last = r.speeds.length - 1;
    expect(r.speeds.slice(0, last).some((v) => v === 0)).toBe(true);
  });

  it('never stops after the first 0.3 s when rest is false', () => {
    const r = run(false);
    const last = r.speeds.length - 1;
    for (let i = 0; i < last; i++) if (r.times[i] > 0.3) expect(r.speeds[i]).toBeGreaterThan(0);
  });

  it('eases: speed never changes by more than base * 11 * dt in a step', () => {
    for (const rest of [true, false]) {
      const r = run(rest);
      expect(r.maxJump).toBeLessThanOrEqual(150 * 11 * DT + 1e-9);
    }
  });

  it('teleports to the end of the path when elapsed exceeds 9 s', () => {
    const s = createSteer(0);
    const head = { x: 0, y: 0 };
    s.path = [{ x: 50, y: 0 }, { x: 5000, y: 100 }];
    s.base = 10;
    s.elapsed = 9;
    const r = stepSteer(s, head, DT, 0, rand);
    expect(r.arrived).toBe(true);
    expect(head).toEqual({ x: 5000, y: 100 });
    expect(s.path).toHaveLength(0);
  });
});
