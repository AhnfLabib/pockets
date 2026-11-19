import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { drawPose, legJoint, tailStrip, type SpriteMeta, type Sprites } from '../../src/stage/render';
import { Rig, type Pose } from '../../src/stage/rig/rig';
import type { Pt } from '../../src/stage/rig/chain';
import { fakeContext, type Call } from './fake-ctx';

const meta: SpriteMeta = JSON.parse(readFileSync(resolve(__dirname, '../../assets/sprites/sprites.json'), 'utf8'));
const sheets = [{ sheet: 0 }, { sheet: 1 }, { sheet: 2 }] as unknown as CanvasImageSource[];
const sprites: Sprites = { sheets, meta };

const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function walkingPose(): Pose {
  const rig = new Rig({ start: { x: 200, y: 200 }, heading: 0, rand: seeded(7) });
  void rig.travel([{ x: 320, y: 220 }, { x: 380, y: 320 }], 120);
  for (let i = 0; i < 40; i++) rig.update(1 / 60);
  return { ...rig.pose(), blink: false };
}

/** Name the sprite part each drawImage call takes its source rect from. */
function partOf(c: Call): string {
  const [, sx, sy] = c.args as number[];
  for (const [name, p] of Object.entries(meta.parts)) {
    if (sx >= p.x - 1e-6 && sx < p.x + p.w && sy >= p.y - 1e-6 && sy < p.y + p.h) return name;
  }
  return '?';
}

/** The sequence of drawn things: parts from drawImage, 'pupil' for arcs after the head. */
function sequence(calls: Call[]): string[] {
  const seq: string[] = [];
  let headSeen = false;
  for (const c of calls) {
    let tag: string | null = null;
    if (c.op === 'drawImage') {
      tag = partOf(c);
      if (tag === 'head') headSeen = true;
    } else if (c.op === 'arc' && headSeen) tag = 'pupil';
    if (tag && seq[seq.length - 1] !== tag) seq.push(tag);
  }
  return seq;
}

describe('tailStrip', () => {
  it('puts edges exactly halfWidths[i] from a straight spine, on opposite sides', () => {
    const spine = [0, 1, 2, 3, 4].map((i) => ({ x: 10 + i * 8, y: 5 }));
    const hw = [5.6, 6.7, 7.0, 6.2, 0];
    const { left, right } = tailStrip(spine, hw);
    expect(left).toHaveLength(5);
    expect(right).toHaveLength(5);
    spine.forEach((p, i) => {
      expect(dist(left[i], p)).toBeCloseTo(hw[i], 9);
      expect(dist(right[i], p)).toBeCloseTo(hw[i], 9);
      if (hw[i] > 0) {
        // opposite sides of the spine line y = 5, perpendicular to it
        expect(left[i].x).toBeCloseTo(p.x, 9);
        expect(right[i].x).toBeCloseTo(p.x, 9);
        expect(Math.sign(left[i].y - 5)).toBe(-Math.sign(right[i].y - 5));
      }
    });
  });

  it('has no self-crossing edge segments on a quarter-circle spine', () => {
    const R = 30;
    const n = 24;
    const spine = Array.from({ length: n + 1 }, (_, i) => {
      const a = (i / n) * (Math.PI / 2);
      return { x: R * Math.cos(a), y: R * Math.sin(a) };
    });
    const hw = spine.map((_, i) => 7 - (i / n) * 6);
    const { left, right } = tailStrip(spine, hw);
    const cross = (a: Pt, b: Pt, c: Pt, d: Pt): boolean => {
      const o = (p: Pt, q: Pt, r: Pt): number => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
      return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
    };
    for (const edge of [left, right]) {
      for (let i = 0; i < edge.length - 1; i++) {
        for (let j = i + 2; j < edge.length - 1; j++) {
          expect(cross(edge[i], edge[i + 1], edge[j], edge[j + 1])).toBe(false);
        }
      }
    }
    // the two edges do not cross each other either
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) expect(cross(left[i], left[i + 1], right[j], right[j + 1])).toBe(false);
    }
  });
});

describe('legJoint', () => {
  it('is upper from the hip and lower from the foot when reachable', () => {
    const hip = { x: 0, y: 0 };
    const foot = { x: 12, y: 5 };
    const j = legJoint(hip, foot, 10.5, 10.5, { x: 20, y: -20 });
    expect(dist(j, hip)).toBeCloseTo(10.5, 9);
    expect(dist(j, foot)).toBeCloseTo(10.5, 9);
  });

  it('bends toward bendToward', () => {
    const hip = { x: 0, y: 0 };
    const foot = { x: 14, y: 0 };
    expect(legJoint(hip, foot, 10.5, 10.5, { x: 7, y: -30 }).y).toBeLessThan(0);
    expect(legJoint(hip, foot, 10.5, 10.5, { x: 7, y: 30 }).y).toBeGreaterThan(0);
  });

  it('lies on the hip-to-foot line when the foot is too far', () => {
    const hip = { x: 3, y: 4 };
    const foot = { x: 33, y: 44 };
    const j = legJoint(hip, foot, 10.5, 10.5, { x: 0, y: 100 });
    expect(dist(j, hip)).toBeCloseTo(10.5, 9);
    expect(dist(hip, j) + dist(j, foot)).toBeCloseTo(dist(hip, foot), 9);
  });
});

describe('drawPose', () => {
  it('draws tail, four legs with paws, body, scarf, head, pupils in that order', () => {
    const { ctx, calls } = fakeContext();
    drawPose(ctx, walkingPose(), sprites, 0);
    const legs = ['legUpper', 'legLower', 'paw'];
    expect(sequence(calls)).toEqual([
      'tail', ...legs, ...legs, ...legs, ...legs, 'body', 'scarf', 'head', 'pupil',
    ]);
  });

  it('draws the tail as many thin slices of the tail sprite', () => {
    const { ctx, calls } = fakeContext();
    drawPose(ctx, walkingPose(), sprites, 0);
    const slices = calls.filter((c) => c.op === 'drawImage' && partOf(c) === 'tail');
    expect(slices.length).toBeGreaterThan(10);
    const tail = meta.parts.tail;
    for (const s of slices) expect((s.args[3] as number)).toBeLessThan(tail.w / 4);
  });

  it('uses sheet Math.floor(t*7) % 3 for every part of a frame', () => {
    for (const t of [0, 0.15, 0.3, 1.0]) {
      const { ctx, calls } = fakeContext();
      drawPose(ctx, walkingPose(), sprites, t);
      const used = new Set(calls.filter((c) => c.op === 'drawImage').map((c) => c.args[0]));
      expect([...used]).toEqual([sheets[Math.floor(t * 7) % 3]]);
    }
  });

  it('draws a soft shadow (blur 7, offset y 3, 22 % black) under tail, legs, body and head only', () => {
    const { ctx, calls } = fakeContext();
    drawPose(ctx, walkingPose(), sprites, 0);
    const shadowed = (c: Call): boolean =>
      c.shadow.blur === 7 && c.shadow.offsetY === 3 && c.shadow.color === 'rgba(0,0,0,0.22)';
    const imgs = calls.filter((c) => c.op === 'drawImage');
    for (const name of ['legUpper', 'legLower', 'body', 'head']) {
      const own = imgs.filter((c) => partOf(c) === name);
      expect(own.length).toBeGreaterThan(0);
      for (const c of own) expect(shadowed(c), name).toBe(true);
    }
    for (const c of imgs.filter((c) => partOf(c) === 'scarf')) expect(shadowed(c)).toBe(false);
    // tail: one shadowed silhouette fill first, then unshadowed slices (no slice shadows its neighbours)
    const firstTail = calls.findIndex((c) => c.op === 'drawImage' && partOf(c) === 'tail');
    expect(calls.slice(0, firstTail).some((c) => c.op === 'fill' && shadowed(c))).toBe(true);
    for (const c of imgs.filter((c) => partOf(c) === 'tail')) expect(shadowed(c)).toBe(false);
  });

  it('draws two pupils with glints when open and two blink discs when blinking', () => {
    const pose = walkingPose();
    const open = fakeContext();
    drawPose(open.ctx, pose, sprites, 0);
    const headAt = open.calls.findIndex((c) => c.op === 'drawImage' && partOf(c) === 'head');
    const arcs = open.calls.slice(headAt).filter((c) => c.op === 'arc').map((c) => c.args as number[]);
    expect(arcs.filter((a) => Math.abs(a[2] - 2.5) < 1e-9)).toHaveLength(2);
    expect(arcs.filter((a) => Math.abs(a[2] - 0.8) < 1e-9)).toHaveLength(2);
    for (const a of arcs.filter((a) => a[2] === 2.5)) {
      // pupil stays inside the eye white at (1.4, ±7.0) r 4.8
      const dy = Math.abs(a[1]) - 7.0;
      expect(Math.hypot(a[0] - 1.4, dy) + 2.5).toBeLessThanOrEqual(4.8);
    }

    const shut = fakeContext();
    drawPose(shut.ctx, { ...pose, blink: true }, sprites, 0);
    const h2 = shut.calls.findIndex((c) => c.op === 'drawImage' && partOf(c) === 'head');
    const discs = shut.calls.slice(h2).filter((c) => c.op === 'arc').map((c) => c.args as number[]);
    expect(discs).toHaveLength(2);
    for (const d of discs) {
      expect(d[0]).toBeCloseTo(1.4, 9);
      expect(Math.abs(d[1])).toBeCloseTo(7.0, 9);
      expect(d[2]).toBeCloseTo(5.4, 9);
    }
  });

  it('leaves the context balanced (every save restored) and draws a carried tab ahead of the head', () => {
    const { ctx, calls } = fakeContext();
    drawPose(ctx, walkingPose(), sprites, 0, { title: 'YouTube', faviconColor: '#d9483b' });
    const saves = calls.filter((c) => c.op === 'save').length;
    expect(saves).toBe(calls.filter((c) => c.op === 'restore').length);
    expect(calls.some((c) => c.op === 'setTransform' || c.op === 'resetTransform')).toBe(false);
    const text = calls.filter((c) => c.op === 'fillText');
    expect(text).toHaveLength(1);
    expect(text[0].args[0]).toBe('YouTube');
    const lastPupil = calls.map((c) => c.op).lastIndexOf('arc');
    expect(calls.findIndex((c) => c.op === 'fillText')).toBeGreaterThan(lastPupil);
  });
});
