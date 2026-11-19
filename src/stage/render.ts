import type { Pt } from './rig/chain';
import type { Pose } from './rig/rig';

export type PartName = 'head' | 'body' | 'tail' | 'legUpper' | 'legLower' | 'paw' | 'scarf';
/** A crop in sheet px (x, y, w, h) with its origin (ox, oy) in display px from the crop's top left. */
export interface SpritePart { x: number; y: number; w: number; h: number; ox: number; oy: number }
export interface SpriteMeta { scale: number; parts: Record<PartName, SpritePart> }
export interface Sprites { sheets: CanvasImageSource[]; meta: SpriteMeta }

const INK = '#23252d';
const FUR = '#8f98a8';
const MASK = '#2f3340';
const SHADOW = 'rgba(0,0,0,0.22)';

/** Leg segment length in display px (joint to joint), from tools/art/README.md. */
const LEG = 10.5;
/** Natural body capsule size in display px. */
const BODY_LEN = 49;
const BODY_WIDTH = 27;
/** Tail sprite: painted length, measured half-widths and how far the chain falls short of it. */
const TAIL_LEN = 56;
const TAIL_U = [0, 6, 16, 30, 42, 50];
const TAIL_HW = [5.6, 6.7, 7.0, 6.2, 5.2, 4.3];
const TAIL_EXTEND = 9;
const TAIL_SLICE = 1.5;
/** Eye whites in head-local display px. */
const EYE_X = 1.4;
const EYE_Y = 7.0;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error(`Pockets: could not load ${src}`));
    img.src = src;
  });
}

/** Load sprites.json and the three boiling sheets from the extension's own `baseUrl` (ending in '/'). */
export async function loadSprites(baseUrl: string): Promise<Sprites> {
  const meta = (await (await fetch(baseUrl + 'sprites.json')).json()) as SpriteMeta;
  const sheets = await Promise.all([0, 1, 2].map((i) => loadImage(`${baseUrl}sheet-${i}.png`)));
  return { sheets, meta };
}

/** Left and right edges of a strip `halfWidths[i]` either side of each spine point. Left is the -side
 *  of travel (side = (-d.y, d.x), as in gait.ts), measured along the bisector of the adjacent links. */
export function tailStrip(spine: Pt[], halfWidths: number[]): { left: Pt[]; right: Pt[] } {
  const left: Pt[] = [];
  const right: Pt[] = [];
  const n = spine.length;
  for (let i = 0; i < n; i++) {
    const a = spine[Math.max(0, i - 1)];
    const b = spine[Math.min(n - 1, i + 1)];
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    const l = Math.hypot(dx, dy) || 1;
    dx /= l;
    dy /= l;
    const p = spine[i];
    const w = halfWidths[i] ?? 0;
    left.push({ x: p.x + dy * w, y: p.y - dx * w });
    right.push({ x: p.x - dy * w, y: p.y + dx * w });
  }
  return { left, right };
}

/** The knee or elbow: `upper` from the hip and `lower` from the foot, on the side nearer `bendToward`.
 *  When the foot is out of reach the joint lies on the hip-to-foot line, `upper` from the hip. */
export function legJoint(hip: Pt, foot: Pt, upper: number, lower: number, bendToward: Pt): Pt {
  const dx = foot.x - hip.x;
  const dy = foot.y - hip.y;
  const d = Math.hypot(dx, dy);
  if (d < 1e-9) {
    const bx = bendToward.x - hip.x;
    const by = bendToward.y - hip.y;
    const bl = Math.hypot(bx, by) || 1;
    return { x: hip.x + (bx / bl) * upper, y: hip.y + (by / bl) * upper };
  }
  const ux = dx / d;
  const uy = dy / d;
  if (d >= upper + lower) return { x: hip.x + ux * upper, y: hip.y + uy * upper };
  const dc = Math.max(d, Math.abs(upper - lower));
  const a = (upper * upper - lower * lower + dc * dc) / (2 * dc);
  const h = Math.sqrt(Math.max(0, upper * upper - a * a));
  const mx = hip.x + ux * a;
  const my = hip.y + uy * a;
  const p1 = { x: mx - uy * h, y: my + ux * h };
  const p2 = { x: mx + uy * h, y: my - ux * h };
  const d1 = Math.hypot(p1.x - bendToward.x, p1.y - bendToward.y);
  const d2 = Math.hypot(p2.x - bendToward.x, p2.y - bendToward.y);
  return d1 <= d2 ? p1 : p2;
}

const angleOf = (v: Pt): number => Math.atan2(v.y, v.x);
const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const unit = (v: Pt): Pt => {
  const l = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / l, y: v.y / l };
};

/** Unit `fwd` from node b toward node b-1 and its `side` (-fwd.y, fwd.x), as in rig.ts. */
function frameAt(nodes: Pt[], b: number): { fwd: Pt; side: Pt } {
  const fwd = unit(sub(nodes[b - 1], nodes[b]));
  return { fwd, side: { x: -fwd.y, y: fwd.x } };
}

function tailHalfWidth(u: number): number {
  if (u <= 0) return TAIL_HW[0];
  if (u >= TAIL_LEN) return 0;
  if (u >= 50) {
    const k = (u - 50) / (TAIL_LEN - 50);
    return TAIL_HW[5] * Math.sqrt(Math.max(0, 1 - k * k));
  }
  let i = 0;
  while (i < TAIL_U.length - 2 && u > TAIL_U[i + 1]) i++;
  const k = (u - TAIL_U[i]) / (TAIL_U[i + 1] - TAIL_U[i]);
  return TAIL_HW[i] + (TAIL_HW[i + 1] - TAIL_HW[i]) * k;
}

/** Catmull-Rom through `pts`, sampled densely, then a lookup from arc length to point and direction. */
function smoothSpine(pts: Pt[]): { length: number; at: (u: number) => { p: Pt; dir: Pt } } {
  const dense: Pt[] = [pts[0]];
  const SUB = 8;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let s = 1; s <= SUB; s++) {
      const t = s / SUB;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number): number =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      dense.push({ x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) });
    }
  }
  const cum = [0];
  for (let i = 1; i < dense.length; i++) cum.push(cum[i - 1] + Math.hypot(dense[i].x - dense[i - 1].x, dense[i].y - dense[i - 1].y));
  const length = cum[cum.length - 1];
  const firstDir = unit(sub(dense[1], dense[0]));
  const lastDir = unit(sub(dense[dense.length - 1], dense[dense.length - 2]));
  const at = (u: number): { p: Pt; dir: Pt } => {
    if (u <= 0) return { p: { x: dense[0].x + firstDir.x * u, y: dense[0].y + firstDir.y * u }, dir: firstDir };
    if (u >= length) {
      const e = dense[dense.length - 1];
      const o = u - length;
      return { p: { x: e.x + lastDir.x * o, y: e.y + lastDir.y * o }, dir: lastDir };
    }
    let lo = 0;
    let hi = cum.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= u) lo = mid;
      else hi = mid;
    }
    const k = (u - cum[lo]) / (cum[hi] - cum[lo] || 1);
    const a = dense[lo];
    const b = dense[hi];
    return { p: { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k }, dir: unit(sub(b, a)) };
  };
  return { length, at };
}

/** Draw one Pose: tail, four legs with paws, body, scarf, head, pupils (then the carried tab, if any). */
export function drawPose(
  ctx: CanvasRenderingContext2D, pose: Pose, sprites: Sprites, t: number,
  carried?: { title: string; faviconColor: string },
): void {
  const { meta } = sprites;
  const S = meta.scale;
  const idx = ((Math.floor(t * 7) % 3) + 3) % 3;
  const sheet = sprites.sheets[idx] ?? sprites.sheets[0];
  const n = pose.nodes;

  const shadowOn = (): void => {
    ctx.shadowColor = SHADOW;
    ctx.shadowBlur = 7;
    ctx.shadowOffsetY = 3;
  };
  const shadowOff = (): void => {
    ctx.shadowColor = 'rgba(0,0,0,0)';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
  };
  const spr = (name: PartName, at: Pt, rot: number, sx = 1, sy = 1): void => {
    const p = meta.parts[name];
    ctx.save();
    ctx.translate(at.x, at.y);
    ctx.rotate(rot);
    if (sx !== 1 || sy !== 1) ctx.scale(sx, sy);
    ctx.drawImage(sheet, p.x, p.y, p.w, p.h, -p.ox, -p.oy, p.w / S, p.h / S);
    ctx.restore();
  };

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const f1 = frameAt(n, 1);
  const f2 = frameAt(n, 2);
  const sw = pose.sway * 2.4;
  const p1 = { x: n[1].x + f1.side.x * sw, y: n[1].y + f1.side.y * sw };
  const p2 = { x: n[2].x - f2.side.x * sw * 1.2, y: n[2].y - f2.side.y * sw * 1.2 };

  // Tail: spine from the swayed hips through the wagging tail nodes, extended to the sprite's length.
  const tp: Pt[] = [p2];
  for (let i = 3; i < n.length; i++) {
    const d = unit(sub(n[i], n[i - 1]));
    const k = i - 2;
    const o = Math.sin(pose.tailPhase - k * 0.7) * k * (0.5 + pose.idle * 1.5);
    tp.push({ x: n[i].x - d.y * o, y: n[i].y + d.x * o });
  }
  const last = unit(sub(tp[tp.length - 1], tp[tp.length - 2]));
  const end = tp[tp.length - 1];
  tp.push({ x: end.x + last.x * TAIL_EXTEND, y: end.y + last.y * TAIL_EXTEND });
  const spine = smoothSpine(tp);
  const ustretch = TAIL_LEN / spine.length; // sprite u per spine length (≈ 1)

  // Shadow once, from the strip silhouette in ink, so slices never shadow one another.
  const outline: Pt[] = [];
  const hws: number[] = [];
  for (let u = 0; u <= TAIL_LEN + 1e-9; u += 2) {
    outline.push(spine.at(u / ustretch).p);
    hws.push(tailHalfWidth(u));
  }
  const strip = tailStrip(outline, hws);
  shadowOn();
  ctx.fillStyle = INK;
  ctx.beginPath();
  strip.left.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
  for (let i = strip.right.length - 1; i >= 0; i--) ctx.lineTo(strip.right[i].x, strip.right[i].y);
  ctx.closePath();
  ctx.fill();
  shadowOff();

  // Slices of the tail sprite, tip first, each a column rotated to the spine there.
  const tail = meta.parts.tail;
  const uMin = tail.ox - tail.w / S; // ≈ -4.3: the rounded base pokes past the origin
  const uMax = tail.ox; // ≈ 58.7: tip ink
  for (let u1 = uMax; u1 > uMin + 1e-9; u1 -= TAIL_SLICE) {
    const u0 = Math.max(uMin, u1 - TAIL_SLICE);
    const mid = spine.at(((u0 + u1) / 2) / ustretch);
    const ang = angleOf(mid.dir) + Math.PI; // sprite +x points from tip to base
    const ov = 0.35; // overlap each side so bends leave no seams
    const a0 = Math.max(uMin, u0 - ov);
    const a1 = Math.min(uMax, u1 + ov);
    ctx.save();
    ctx.translate(mid.p.x, mid.p.y);
    ctx.rotate(ang);
    const c = (u0 + u1) / 2;
    // sprite column x = (ox - u) * scale; local x = c - u (toward the base is +x)
    ctx.drawImage(sheet, tail.x + (tail.ox - a1) * S, tail.y, (a1 - a0) * S, tail.h, c - a1, -tail.oy, a1 - a0, tail.h / S);
    ctx.restore();
  }

  // Legs: upper from hip/shoulder to the knee/elbow, lower to the foot, then the paw.
  shadowOn();
  pose.feet.forEach((foot, i) => {
    const fr = i < 2 ? f1 : f2;
    const b = i < 2 ? p1 : p2;
    const s = i % 2 ? 1 : -1;
    const hip = { x: b.x + fr.side.x * s * 8, y: b.y + fr.side.y * s * 8 };
    const f = foot.pos;
    const mid = { x: (hip.x + f.x) / 2, y: (hip.y + f.y) / 2 };
    const back = i < 2 ? -1 : 1; // elbows bend back, knees forward
    const bend = { x: mid.x + fr.fwd.x * back * 30, y: mid.y + fr.fwd.y * back * 30 };
    const j = legJoint(hip, f, LEG, LEG, bend);
    spr('legUpper', hip, angleOf(sub(j, hip)), Math.max(1, Math.hypot(j.x - hip.x, j.y - hip.y) / LEG), 1);
    const lowerLen = Math.hypot(f.x - j.x, f.y - j.y);
    spr('legLower', j, angleOf(sub(f, j)), Math.max(1, lowerLen / LEG), 1);
    spr('paw', f, angleOf(fr.fwd), foot.stepping ? 1.15 : 1, foot.stepping ? 1.15 : 1);
  });

  // Body between the swayed shoulders and hips, breathing and crouching.
  const bw = 27 + pose.breath * (0.5 + pose.idle * 1.2) + (1 - pose.stretch) * 14;
  const bl = Math.hypot(p1.x - p2.x, p1.y - p2.y) + bw;
  spr('body', { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }, angleOf(sub(p1, p2)), bl / BODY_LEN, bw / BODY_WIDTH);
  shadowOff();

  // Scarf at the neck; its sprite origin already includes the mock's -5 px shift (tools/art/README.md).
  const neck = { x: (n[0].x + p1.x) / 2, y: (n[0].y + p1.y) / 2 };
  spr('scarf', neck, angleOf(f1.fwd) + Math.sin(pose.tailPhase * 1.4) * 0.22);

  // Head: pivots 10 px behind node 0 and swings by the head angle; sniff bobs it forward.
  const ha = angleOf(f1.fwd) + pose.headAngle;
  const sn = Math.sin(pose.sniff * 19) * 1.2 * pose.sniff;
  const hx = n[0].x - f1.fwd.x * 10 + Math.cos(ha) * (10 + sn);
  const hy = n[0].y - f1.fwd.y * 10 + Math.sin(ha) * (10 + sn);
  shadowOn();
  spr('head', { x: hx, y: hy }, ha, 1, 1 + pose.ear * 0.03);
  shadowOff();

  // Pupils, glints or the blink, on the eye whites painted in the head sprite.
  ctx.save();
  ctx.translate(hx, hy);
  ctx.rotate(ha);
  if (pose.blink) {
    ctx.fillStyle = MASK;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(EYE_X, s * EYE_Y, 5.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = FUR;
    ctx.lineWidth = 1.3;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(EYE_X + 0.2, s * EYE_Y - 3.2);
      ctx.lineTo(EYE_X + 0.2, s * EYE_Y + 3.2);
      ctx.stroke();
    }
  } else {
    const ey = Math.max(-1, Math.min(1, pose.eye)) * 1.1;
    for (const s of [-1, 1]) {
      const px = EYE_X + 1.0;
      const py = s * EYE_Y + ey;
      ctx.fillStyle = '#14161c';
      ctx.beginPath();
      ctx.arc(px, py, 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(px + 0.9, py - 0.9, 0.8, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();

  // The carried tab, held about 19 px ahead of the head.
  if (carried) {
    const x = hx + Math.cos(ha) * 19;
    const y = hy + Math.sin(ha) * 19;
    ctx.font = '500 10px "DM Sans", sans-serif';
    let title = carried.title;
    const maxW = 110;
    if (ctx.measureText(title).width > maxW) {
      while (title.length > 1 && ctx.measureText(title + '…').width > maxW) title = title.slice(0, -1);
      title += '…';
    }
    const boxW = Math.max(62, 26 + ctx.measureText(title).width);
    const left = x - boxW / 2;
    shadowOn();
    ctx.fillStyle = '#fbfaf5';
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.roundRect(left, y - 9, boxW, 18, [6, 6, 0, 0]);
    ctx.fill();
    shadowOff();
    ctx.stroke();
    ctx.fillStyle = carried.faviconColor;
    ctx.beginPath();
    ctx.roundRect(left + 6, y - 5, 10, 10, 2);
    ctx.fill();
    ctx.fillStyle = '#1c2230';
    ctx.textBaseline = 'middle';
    ctx.fillText(title, left + 20, y + 0.5);
  }
  ctx.restore();
}
