import type { Pt } from './chain';

export interface Foot { pos: Pt; from: Pt; to: Pt; t: number; stepping: boolean; threshold: number }
/** Unit vectors `fwd` and `side` at a body node (front = shoulders, rear = hips). */
export interface BodyFrame { origin: Pt; fwd: Pt; side: Pt }

/** A foot may not start a step while either listed neighbour is stepping. */
const ADJ = [[1, 2], [0, 3], [0, 3], [1, 2]];
const SNAP_DIST = 48;
const DEFAULT_THRESHOLD = 13;
const OVERSHOOT = 1.3;

/** Feet are indexed front-left, front-right, rear-left, rear-right. */
export function footHome(i: 0 | 1 | 2 | 3, front: BodyFrame, rear: BodyFrame, reaching: boolean): Pt {
  const isFront = i < 2;
  const b = isFront ? front : rear;
  const s = i % 2 ? 1 : -1;
  const fw = isFront ? (reaching ? 21 : 9) : 1;
  const lat = isFront && reaching ? 8 : 15;
  return {
    x: b.origin.x + b.fwd.x * fw + b.side.x * s * lat,
    y: b.origin.y + b.fwd.y * fw + b.side.y * s * lat,
  };
}

export function createFeet(front: BodyFrame, rear: BodyFrame): Foot[] {
  return ([0, 1, 2, 3] as const).map((i) => {
    const h = footHome(i, front, rear, false);
    return {
      pos: { ...h },
      from: { ...h },
      to: { ...h },
      t: 0,
      stepping: false,
      threshold: DEFAULT_THRESHOLD,
    };
  });
}

/** Advance the four feet one tick: each stays planted until its home drifts past its threshold, then steps. */
export function stepGait(
  feet: Foot[],
  front: BodyFrame,
  rear: BodyFrame,
  speed: number,
  reaching: boolean,
  dt: number,
  rand: () => number,
): void {
  const dur = speed > 250 ? 0.05 : 0.12;
  for (let i = 0; i < 4; i++) {
    const f = feet[i];
    const home = footHome(i as 0 | 1 | 2 | 3, front, rear, reaching);
    const d = Math.hypot(f.pos.x - home.x, f.pos.y - home.y);
    if (d > SNAP_DIST) {
      f.pos = { ...home };
      f.stepping = false;
      continue;
    }
    if (f.stepping) {
      f.t += dt / dur;
      const k = Math.min(1, f.t);
      const c = OVERSHOOT;
      const e = 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2);
      f.pos = { x: f.from.x + (f.to.x - f.from.x) * e, y: f.from.y + (f.to.y - f.from.y) * e };
      if (k >= 1) f.stepping = false;
    } else if (d > f.threshold && !ADJ[i].some((j) => feet[j].stepping)) {
      const b = i < 2 ? front : rear;
      const ahead = speed > 20 ? 8 : 0;
      f.from = { ...f.pos };
      f.to = { x: home.x + b.fwd.x * ahead, y: home.y + b.fwd.y * ahead };
      f.t = 0;
      f.stepping = true;
      f.threshold = 11 + rand() * 5;
    }
  }
}
