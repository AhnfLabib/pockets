import { createChain, followChain, type Pt } from './chain';
import { createSteer, stepSteer, type Steer } from './steer';
import { TEMPO } from './tempo';
import { createFeet, stepGait, type BodyFrame, type Foot } from './gait';
import { stepHead, type Head, type HeadMode } from './head';

/** Short pieces of business Pockets does on the way up. All but tiptoe stop him for their length. */
export type QuirkKind = 'scratch' | 'glance' | 'sniff' | 'freeze' | 'stepBack' | 'tailFlick' | 'lookAtPointer' | 'tiptoe';
export const QUIRK_KINDS: readonly QuirkKind[] = ['scratch', 'glance', 'sniff', 'freeze', 'stepBack', 'tailFlick', 'lookAtPointer', 'tiptoe'];
/** How long each quirk lasts, in seconds (already at the new tempo; every one is at most 1.5 s). */
export const QUIRK_SECONDS: Record<QuirkKind, number> = {
  scratch: 1.3, glance: 0.95, sniff: 1.0, freeze: 0.75, stepBack: 1.0, tailFlick: 1.0, lookAtPointer: 1.15, tiptoe: 1.3,
};
/**
 * A quirk attached to one travel(). `at` is how far along the path (px) it starts; for tiptoe it is how far from the
 * end. `side` (-1 or 1) picks the ear, shoulder or direction. A quirk that has not started when the path ends is
 * dropped, so none ever runs once travel() has resolved.
 */
export interface Quirk { kind: QuirkKind; at: number; side: number; lookAt?: () => Pt | null }

interface ActiveQuirk { q: Quirk; t: number; dur: number; freezeLook: number; sniffTick: number; base: number }

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
  private pending: Quirk[] = [];
  private quirk: ActiveQuirk | null = null;
  private travelled = 0;
  private liftedFoot: number | undefined;
  /** Every quirk that has started, for tests and the character page. */
  readonly quirkLog: QuirkKind[] = [];

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

  /** Resolves true on arrival, false when superseded by another travel() or stopped by travel([]). `quirks` run on
   *  the way (never in still mode) and are all finished or dropped by the time it resolves. */
  travel(path: Pt[], speed: number, opts?: { rest?: boolean; quirks?: Quirk[] }): Promise<boolean> {
    this.resolve?.(false);
    this.resolve = null;
    this.stillPending = false;
    this.endQuirk();
    this.pending = [];
    this.travelled = 0;
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
      // The safety net allows twice the path's length at full speed (2.6x when resting), and never less than 9 s.
      let len = 0;
      let prev = this.nodes[0];
      for (const p of s.path) {
        len += Math.hypot(p.x - prev.x, p.y - prev.y);
        prev = p;
      }
      s.rest = (opts?.rest ?? true) && speed < 250;
      // Rests take about a third of a walk, so a walking leg gets more slack than a run (exits may cross the
      // whole screen, which puts a plain 2x within reach of a long walk).
      s.timeout = Math.max(9, speed > 0 ? ((s.rest ? 2.6 : 2) * len) / speed : 9);
      s.burst = (0.4 + this.rand() * 0.7) / TEMPO;
      // Stopping quirks do not advance the steering clock; tiptoe slows the walk, so it gets its own length on top.
      this.pending = (opts?.quirks ?? []).filter((q) => q.kind !== 'tiptoe').sort((a, b) => a.at - b.at);
      const tip = opts?.quirks?.find((q) => q.kind === 'tiptoe');
      if (tip) {
        this.pending.push(tip);
        s.timeout += QUIRK_SECONDS.tiptoe * 2;
      }
    });
  }

  /** A quirk is running right now. */
  get quirking(): boolean { return this.quirk !== null; }

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
    } else if (this.quirk && this.quirk.q.kind !== 'tiptoe') {
      this.coast(dt);
      this.steerDelta = 0;
    } else {
      this.maybeStartQuirk();
      const r = stepSteer(s, this.nodes[0], dt, this.t, this.rand);
      this.travelled += s.speed * dt;
      this.steerDelta = r.delta;
      if (this.quirk?.q.kind === 'tiptoe') {
        this.quirk.t += dt;
        if (this.quirk.t >= this.quirk.dur) this.endQuirk();
      }
      if (r.arrived) {
        this.endQuirk();
        this.pending = [];
        const res = this.resolve;
        this.resolve = null;
        res?.(true);
      }
    }

    const q = this.quirk;
    this.idle += ((s.speed < 12 ? 1 : 0) - this.idle) * Math.min(1, dt * 5);
    this.stretch += (this.stretchTarget - this.stretch) * Math.min(1, dt * 12);
    this.tailPhase += dt * (2.1 + (1 - this.idle) * 4.5);
    if (q?.q.kind === 'tailFlick') this.tailPhase += dt * 15;
    if (q?.q.kind === 'freeze') this.tailPhase -= dt * 1.6;
    followChain(this.nodes, this.stretch);

    const { front, rear } = this.frames();
    if (q?.q.kind !== 'freeze') {
      stepGait(this.feet, front, rear, s.speed, this.reach, dt, this.rand,
        { slow: q?.q.kind === 'tiptoe' ? 1.8 : 1, skip: this.liftedFoot });
    }
    let quirkLook: number | null = null;
    if (q && q.q.kind !== 'tiptoe') quirkLook = this.quirkEffects(q, front);

    const mode: HeadMode = this.look ? 'look' : this.reach ? 'reach' : quirkLook !== null || s.pause > 0 ? 'pause' : 'travel';
    stepHead(this.head, mode, this.steerDelta, quirkLook ?? s.lookTarget, dt, this.t, this.rand);
  }

  /** Start the next pending quirk once Pockets has come far enough (never right on top of a waypoint). */
  private maybeStartQuirk(): void {
    const s = this.steer;
    const next = this.pending[0];
    if (!next || this.quirk || s.path.length === 0) return;
    const head = this.nodes[0];
    if (next.kind === 'tiptoe') {
      let left = 0;
      let prev = head;
      for (const p of s.path) { left += Math.hypot(p.x - prev.x, p.y - prev.y); prev = p; }
      if (left > next.at) return;
    } else {
      if (this.travelled < next.at) return;
      const g = s.path[0];
      if (Math.hypot(g.x - head.x, g.y - head.y) < 45) return;
    }
    this.pending.shift();
    const dur = QUIRK_SECONDS[next.kind];
    this.quirk = { q: next, t: 0, dur, freezeLook: this.head.angle, sniffTick: -1, base: s.base };
    this.quirkLog.push(next.kind);
    if (next.kind === 'freeze') s.speed = 0;
    if (next.kind === 'tiptoe') s.base *= 0.45;
  }

  /** A stopping quirk: brake to a halt along the heading (or back up for stepBack), and count its time. */
  private coast(dt: number): void {
    const s = this.steer;
    const q = this.quirk!;
    const head = this.nodes[0];
    let v = s.speed;
    let dir = 1;
    s.speed = Math.max(0, s.speed * (1 - Math.min(1, dt * 12)));
    if (s.speed < 1) s.speed = 0;
    if (q.q.kind === 'stepBack' && q.t > 0.15 && q.t < 0.55) {
      v = 42;
      dir = -1;
      s.speed = 0;
    }
    head.x += Math.cos(s.heading) * v * dt * dir;
    head.y += Math.sin(s.heading) * v * dt * dir;
    s.phase += (v * dt) / 9;
    q.t += dt;
    if (q.t >= q.dur) this.endQuirk();
  }

  /** The head target (pause look) and paw, ear and sniff business for the running quirk. */
  private quirkEffects(q: ActiveQuirk, front: BodyFrame): number {
    const k = q.t / q.dur;
    const side = q.q.side < 0 ? -1 : 1;
    const h = this.head;
    switch (q.q.kind) {
      case 'scratch': {
        if (k > 0.15 && k < 0.85) {
          h.ear = 1;
          const i = side > 0 ? 1 : 0;
          this.liftedFoot = i;
          const f = this.feet[i];
          const wob = Math.sin(q.t * 22) * 2.2;
          f.stepping = true;
          f.pos = {
            x: front.origin.x + front.fwd.x * (15 + wob) + front.side.x * side * 9,
            y: front.origin.y + front.fwd.y * (15 + wob) + front.side.y * side * 9,
          };
          f.from = { ...f.pos };
          f.to = { ...f.pos };
        } else if (this.liftedFoot !== undefined) {
          this.dropFoot();
        }
        return side * 0.5 + Math.sin(q.t * 17) * 0.12;
      }
      case 'glance':
        return k < 0.72 ? side * 1.3 : 0;
      case 'sniff': {
        const tick = Math.floor(q.t / 0.2);
        if (tick !== q.sniffTick) { q.sniffTick = tick; h.sniff = 1; }
        return Math.sin(q.t * 6) * 0.18;
      }
      case 'freeze':
        return q.freezeLook;
      case 'stepBack':
        return k < 0.6 ? side * 0.35 : 0;
      case 'tailFlick':
        return k > 0.2 && k < 0.8 ? side * 0.6 : 0;
      case 'lookAtPointer': {
        const p = q.q.lookAt?.() ?? null;
        if (!p || k > 0.85) return 0;
        const n = this.nodes;
        const body = Math.atan2(n[0].y - n[1].y, n[0].x - n[1].x);
        const a = Math.atan2(p.y - n[0].y, p.x - n[0].x) - body;
        return Math.max(-1.3, Math.min(1.3, Math.atan2(Math.sin(a), Math.cos(a))));
      }
      default:
        return 0;
    }
  }

  private dropFoot(): void {
    const i = this.liftedFoot;
    if (i === undefined) return;
    this.liftedFoot = undefined;
    const f = this.feet[i];
    f.stepping = false;
    f.from = { ...f.pos };
    f.to = { ...f.pos };
    f.t = 0;
  }

  private endQuirk(): void {
    const q = this.quirk;
    if (!q) return;
    this.quirk = null;
    if (q.q.kind === 'tiptoe') this.steer.base = q.base;
    this.dropFoot();
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
