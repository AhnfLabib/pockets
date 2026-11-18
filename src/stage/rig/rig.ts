import { createChain, followChain, type Pt } from './chain';
import { createSteer, stepSteer, type Steer } from './steer';
import { createFeet, stepGait, type BodyFrame, type Foot } from './gait';
import { stepHead, type Head, type HeadMode } from './head';

export interface Pose {
  nodes: Pt[]; feet: Foot[]; headAngle: number; eye: number; sniff: number; ear: number; blink: boolean;
  sway: number; idle: number; stretch: number; tailPhase: number; breath: number;
}

const frameAt = (origin: Pt, from: Pt): BodyFrame => {
  const dx = from.x - origin.x;
  const dy = from.y - origin.y;
  const l = Math.hypot(dx, dy) || 1;
  const fwd = { x: dx / l, y: dy / l };
  return { origin: { x: origin.x, y: origin.y }, fwd, side: { x: -fwd.y, y: fwd.x } };
};

export class Rig {
  private nodes: Pt[];
  private feet: Foot[];
  private steer: Steer;
  private head: Head = { angle: 0, vel: 0, gaze: 0, gazeTimer: 0, eye: 0, sniff: 0, ear: 0, blink: false };
  private rand: () => number;
  private still: boolean;
  private t = 0;
  private idle = 1;
  private stretch = 1;
  private stretchTarget = 1;
  private tailPhase = 0;
  private look = false;
  private reach = false;
  private steerDelta = 0;
  private resolve: ((arrived: boolean) => void) | null = null;
  private stillPending = false;

  constructor(opts: { start: Pt; heading: number; rand: () => number; still?: boolean }) {
    this.rand = opts.rand;
    this.still = !!opts.still;
    this.nodes = createChain(opts.start, opts.heading);
    this.steer = createSteer(opts.heading);
    this.feet = createFeet(this.frames().front, this.frames().rear);
  }

  private frames(): { front: BodyFrame; rear: BodyFrame } {
    const n = this.nodes;
    return { front: frameAt(n[1], n[0]), rear: frameAt(n[2], n[1]) };
  }

  /** Resolves true on arrival, false when superseded by another travel() or stopped by travel([]). */
  travel(path: Pt[], speed: number, opts?: { rest?: boolean }): Promise<boolean> {
    this.resolve?.(false);
    this.resolve = null;
    this.stillPending = false;
    if (path.length === 0) {
      this.steer.path = [];
      return Promise.resolve(true);
    }
    return new Promise<boolean>((res) => {
      this.resolve = res;
      if (this.still) {
        const end = path[path.length - 1];
        const heading = this.steer.heading;
        this.nodes = createChain(end, heading);
        const { front, rear } = this.frames();
        this.feet = createFeet(front, rear);
        this.steer.path = [];
        this.stillPending = true;
        return;
      }
      const s = this.steer;
      s.path = path.map((p) => ({ x: p.x, y: p.y }));
      s.base = speed;
      s.elapsed = 0;
      s.rest = (opts?.rest ?? true) && speed < 250;
      s.burst = 0.5 + this.rand() * 0.5;
    });
  }

  setLook(on: boolean): void { this.look = on; }
  setReach(on: boolean): void { this.reach = on; }
  setStretch(target: number): void { this.stretchTarget = target; }

  update(dt: number): void {
    this.t += dt;
    const s = this.steer;

    if (this.stillPending) {
      this.stillPending = false;
      const r = this.resolve;
      this.resolve = null;
      r?.(true);
    } else {
      const r = stepSteer(s, this.nodes[0], dt, this.t, this.rand);
      this.steerDelta = r.delta;
      if (r.arrived) {
        const res = this.resolve;
        this.resolve = null;
        res?.(true);
      }
    }

    this.idle += ((s.speed < 12 ? 1 : 0) - this.idle) * Math.min(1, dt * 5);
    this.stretch += (this.stretchTarget - this.stretch) * Math.min(1, dt * 12);
    this.tailPhase += dt * (2.1 + (1 - this.idle) * 4.5);
    followChain(this.nodes, this.stretch);

    const { front, rear } = this.frames();
    stepGait(this.feet, front, rear, s.speed, this.reach, dt, this.rand);

    const mode: HeadMode = this.look ? 'look' : this.reach ? 'reach' : s.pause > 0 ? 'pause' : 'travel';
    stepHead(this.head, mode, this.steerDelta, s.lookTarget, dt, this.t, this.rand);
  }

  pose(): Pose {
    return {
      nodes: this.nodes.map((p) => ({ x: p.x, y: p.y })),
      feet: this.feet.map((f) => ({
        ...f, pos: { ...f.pos }, from: { ...f.from }, to: { ...f.to },
      })),
      headAngle: this.head.angle,
      eye: this.head.eye,
      sniff: this.head.sniff,
      ear: this.head.ear,
      blink: this.head.blink,
      sway: Math.sin(this.steer.phase) * (1 - this.idle),
      idle: this.idle,
      stretch: this.stretch,
      tailPhase: this.tailPhase,
      breath: Math.sin(this.t * 2.6),
    };
  }
}
