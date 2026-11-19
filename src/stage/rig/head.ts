export type HeadMode = 'travel' | 'look' | 'reach' | 'pause';

export interface Head {
  angle: number;
  vel: number;
  gaze: number;
  gazeTimer: number;
  eye: number;
  sniff: number;
  ear: number;
  blink: boolean;
}

const STIFFNESS = 230;
const DAMPING = 19;
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** Advance the head one tick: re-pick gaze, spring the neck toward its target, update eyes, sniff, ear and blink. */
export function stepHead(
  h: Head, mode: HeadMode, steerDelta: number, pauseLook: number,
  dt: number, t: number, rand: () => number,
): void {
  h.gazeTimer -= dt;
  if (h.gazeTimer <= 0) {
    h.gazeTimer = 0.35 + rand() * 0.95;
    if (mode === 'reach') h.gaze = rand() < 0.45 ? 0.8 : (rand() - 0.5) * 0.3;
    else h.gaze = (rand() * 2 - 1) * 0.7;
    if (rand() < 0.45) h.sniff = 1;
  }

  let target: number;
  if (mode === 'look' || mode === 'reach') target = h.gaze;
  else if (mode === 'pause') target = pauseLook;
  else target = clamp(steerDelta * 0.6, -0.6, 0.6);

  h.vel += ((target - h.angle) * STIFFNESS - h.vel * DAMPING) * dt;
  h.angle += h.vel * dt;
  h.eye = clamp((target - h.angle) * 2.2, -1, 1);
  h.sniff = Math.max(0, h.sniff - dt * 2.2);
  if (rand() < dt * 0.6) h.ear = 1;
  h.ear = Math.max(0, h.ear - dt * 6);
  h.blink = t % 3.7 < 0.13;
}
