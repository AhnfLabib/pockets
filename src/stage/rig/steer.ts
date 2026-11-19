import type { Pt } from './chain';

export interface Steer {
  heading: number;
  speed: number;
  path: Pt[];
  base: number;
  rest: boolean;
  burst: number;
  pause: number;
  lookTarget: number;
  phase: number;
  elapsed: number;
  /** Seconds before the safety net abandons the path by jumping to its end. Rig.travel sets it per path. */
  timeout: number;
}

export function createSteer(heading: number): Steer {
  return {
    heading, speed: 0, path: [], base: 0, rest: false,
    burst: 0.75, pause: 0, lookTarget: 0, phase: 0, elapsed: 0, timeout: 9,
  };
}

const noise = (t: number): number =>
  Math.sin(t * 1.3) * 0.5 + Math.sin(t * 2.9 + 1.7) * 0.3 + Math.sin(t * 5.3 + 0.4) * 0.2;

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Advance the head along s.path[0..]. Mutates `s` and `head`.
 * `arrived` is true on the step the last waypoint is reached.
 * `delta` is the signed angle from the heading to the current waypoint.
 */
export function stepSteer(
  s: Steer, head: Pt, dt: number, t: number, rand: () => number,
): { arrived: boolean; delta: number } {
  if (s.path.length === 0) {
    s.speed += (0 - s.speed) * Math.min(1, dt * 10);
    if (s.speed < 1) s.speed = 0;
    s.elapsed = 0;
    return { arrived: false, delta: 0 };
  }

  const g = s.path[0];
  const dx = g.x - head.x;
  const dy = g.y - head.y;
  const d = Math.hypot(dx, dy);
  const lastPt = s.path.length === 1;
  s.elapsed += dt;

  // Safety net: abandon the path by jumping to its end.
  if (s.elapsed > s.timeout) {
    const end = s.path[s.path.length - 1];
    head.x = end.x;
    head.y = end.y;
    s.path = [];
    s.elapsed = 0;
    s.speed = 0;
    return { arrived: true, delta: 0 };
  }

  const fast = s.base > 250;
  let want = 0;
  if (s.pause > 0) {
    s.pause -= dt;
  } else {
    want = s.base;
    if (lastPt) want = Math.min(want, Math.max(40, d * 5));
    if (s.rest) {
      s.burst -= dt;
      if (s.burst <= 0 && d > 70) {
        s.pause = 0.22 + rand() * 0.45;
        s.burst = 0.55 + rand() * 0.75;
        s.lookTarget = (rand() - 0.5) * 1.7;
      }
    }
  }

  s.speed += (want - s.speed) * Math.min(1, dt * (want > s.speed ? 7 : 11));
  if (want === 0 && s.speed < 1) s.speed = 0;

  const delta = wrap(Math.atan2(dy, dx) - s.heading);
  const rate = d < 40 ? 14 : fast ? 12 : 7;
  s.heading += Math.max(-rate * dt, Math.min(rate * dt, delta));
  if (d > 45 && s.speed > 30 && !fast) s.heading += noise(t * 1.7) * 0.9 * dt;

  const step = s.speed * dt;
  head.x += Math.cos(s.heading) * step;
  head.y += Math.sin(s.heading) * step;
  s.phase += step / 9;

  const radius = lastPt ? 3.5 : fast ? 30 : 16;
  let arrived = false;
  if (d < radius) {
    if (lastPt) {
      head.x = g.x;
      head.y = g.y;
      arrived = true;
    }
    s.path.shift();
  }
  return { arrived, delta };
}
