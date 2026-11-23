// The heist cut's scenes. Each gets its frame relative to its own start (Remotion Sequence) plus the absolute beat
// frames it needs from the timeline, so footage frames are pinned to beats: the card's own ticks land on the giant
// countdown digits, the take lands on the steal beat and the Undo click lands on the Undo beat.
import React from "react";
import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { FootageManifest, PopupManifest } from "../types";
import { B, CARD_PUNCH, COUNTDOWN, ENDCARD, FINAL, SCENES, UNDO } from "./timeline";
import { BAR, TabBar, tabCenter } from "./tabbar";
import { CaseTag, Cursor, HEAVY, Lock, MONO, N, Pin, Pool, Ring, Shot, Spotlight, Track, headAt, punch, snap, useLayout, type HeistLayout } from "./kit";

export interface SceneProps { m: FootageManifest; track: Track | null; popup: PopupManifest | null }

const mark = (m: FootageManifest, name: string): number => {
  const hit = m.marks.find((x) => x.event === name);
  if (!hit) throw new Error(`footage manifest has no "${name}" mark`);
  return hit.frame;
};
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
/** Scene start frame. */
const S = (name: keyof typeof SCENES) => B(SCENES[name][0]);
/** In the captured page (CSS px): the YouTube tab's centre in its strip (tab 19 of 47; strip padding 8 px left,
 * 100 px right, 480 px wide), the top of the page under the toolbar, and the left edge of the warning card. */
const TAB = { x: 8 + 19.5 * (372 / 47), y: 26 };
const PAGE_TOP = 86;
/** Fade (CSS px) before the captured page's right edge in wide frames. */
const fadeR = (L: HeistLayout) => (L.land ? 40 : undefined);
/** Just above the warning card's top edge: the warning shows the card alone, not the page heading above it. */
const CARD_TOP = 146;

/** Clip path (screen px) hiding the warning card and its soft shadow in the bare capture: right of x 178 below y 138,
 * and everything below y 174 (Pockets ends at y 169 in these frames). */
const cardCut = (tx: number, top: number, s: number) => {
  const X = Math.round(tx + (178 - TAB.x) * s), Y = Math.round(top + (138 - PAGE_TOP) * s), Y2 = Math.round(top + (174 - PAGE_TOP) * s);
  return `polygon(0px 0px, 9999px 0px, 9999px ${Y}px, ${X}px ${Y}px, ${X}px ${Y2}px, 0px ${Y2}px)`;
};

/** Where the big vector tab bar sits in the scenes that show it close (whip, Undo pop-back, working swing). */
const bigBar = (L: HeistLayout) =>
  L.land ? { top: 110, scale: 2.5, x: L.subject.x } : L.square ? { top: 150, scale: 2.0, x: L.W / 2 } : { top: Math.round(L.subject.y - 170), scale: 2.5, x: L.W / 2 };
/** Screen y of the middle of the tab strip of a bar at `top`, `scale`. */
const stripMid = (top: number, scale: number) => top + (BAR.stripH * scale) / 2 + 3 * scale;

// 1. Black, then the spotlight snaps on: Pockets perched just under a real-looking, crammed tab bar (vector), right
// below his target. He is the alpha cutout of the real footage, placed so the captured page's geometry lines up with
// the bar: the footage's YouTube tab centre sits on the bar's YouTube tab, the footage's page top on the bar's bottom.
export const Spotlit: React.FC<SceneProps> = ({ m, track }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const L = useLayout();
  const n = 138 + f; // perched under the strip, eyes on the tabs (the climb itself is scene 3)
  const g = L.land ? { top: 64, scale: 1.25, tx: Math.round(L.W * 0.33), s: 8.4 } : L.square ? { top: 40, scale: 1.1, tx: Math.round(L.W * 0.6), s: 4.6 } : { top: 230, scale: 1.2, tx: Math.round(L.W * 0.62), s: 7 };
  const barBottom = g.top + (BAR.stripH + BAR.toolbarH) * g.scale;
  const [hx, hy] = headAt(track, Math.round(n), 6);
  const headX = g.tx + (hx - TAB.x) * g.s, headY = barBottom + (hy - PAGE_TOP) * g.s;
  const iris = snap(f, fps);
  return (
    <AbsoluteFill style={{ background: N.bgDeep }}>
      <AbsoluteFill style={{ transform: `scale(${punch(f, fps, 0.1)})`, transformOrigin: `${headX}px ${barBottom}px` }}>
        {/* Cut off right of his body: the bare capture also holds the warning card, which comes later. */}
        <div style={{ position: "absolute", left: 0, top: 0, width: L.W, height: L.H, clipPath: cardCut(g.tx, barBottom, g.s) }}>
          <Shot m={m} n={n} cx={TAB.x} cy={PAGE_TOP} x={g.tx} y={barBottom} scale={g.s} bare />
        </div>
      </AbsoluteFill>
      <Spotlight x={headX - 120} y={headY + 80} r={30 + (L.square ? 460 : 620) * iris} dark={0.95} />
      <TabBar top={g.top} scale={g.scale} focus={tabCenter(BAR.target)} atX={g.tx} opacity={iris} />
    </AbsoluteFill>
  );
};

// 2. Whip-pan along the tab bar; it lands on the one that glows (YouTube).
export const Whip: React.FC<SceneProps> = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const L = useLayout();
  const g = bigBar(L);
  const p = interpolate(f, [0, 8], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const p0 = interpolate(f - 1, [0, 8], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const span = 14 * BAR.tabW;
  const blur = Math.abs(p - p0) * span * g.scale * 0.06;
  const drift = interpolate(f, [8, 60], [0, 6], clamp);
  const glowAt = B(SCENES.whip[0] + 1) - B(SCENES.whip[0]); // lands with "is mine."
  const glow = snap(f - glowAt, fps);
  const scale = g.scale * punch(f - glowAt, fps, 0.06);
  const y = stripMid(g.top, scale);
  return (
    <AbsoluteFill style={{ background: N.bgDeep }}>
      <TabBar top={g.top} scale={scale} focus={tabCenter(BAR.target) - span * (1 - p) + drift} atX={g.x} glow={glow} blur={blur} />
      <Spotlight x={g.x} y={y} r={(L.land ? 520 : 420) + 160 * glow} dark={0.86} />
    </AbsoluteFill>
  );
};

// 3. Tight on him scrambling up the page edge (sped up), with the case-file tag.
export const Climb: React.FC<SceneProps> = ({ m, track }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const L = useLayout();
  const len = S("warning") - S("climb");
  const n = interpolate(f, [0, len], [84, 136], clamp);
  const [hx, hy] = headAt(track, Math.round(n), 6);
  const s = 8.5 * L.zoom;
  const x = L.subject.x, y = L.subject.y + 60;
  const tagAt = B(SCENES.climb[0] + 2) - S("climb");
  return (
    <AbsoluteFill style={{ background: N.bgDeep }}>
      <AbsoluteFill style={{ transform: `scale(${punch(f, fps, 0.14)})` }}>
        <Shot m={m} n={n} cx={hx} cy={hy + 20} x={x} y={y} scale={s} cropTop={PAGE_TOP} fadeRight={fadeR(L)} />
      </AbsoluteFill>
      <Spotlight x={x} y={y} r={470} />
      <CaseTag text="TARGET: YouTube · IDLE 2 DAYS" f={f - tagAt} fps={fps} x={L.land ? L.captionX : L.W / 2} y={L.square ? 60 : L.land ? 250 : 210} size={L.square ? 28 : 34} align="center" />
    </AbsoluteFill>
  );
};

// 4. The warning card; a giant countdown 5 · 4 · 3 · 2 · 1, one digit per beat into the steal accent, each a jump
// cut to the card's own tick so the card's "Mine in N..." matches the digit.
export const Warning: React.FC<SceneProps> = ({ m }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const L = useLayout();
  const t0 = S("warning");
  const abs = t0 + f;
  const card = mark(m, "card-shown");
  // Footage: the card appearing and holding on "5" (slowed so it never reaches its own "4" before the big 5), then
  // jumps so the card reads N exactly when the big digit does.
  const pre = B(COUNTDOWN[0].beat) - t0;
  let n = interpolate(f, [0, pre], [card + 2, mark(m, "tick 4") - 3], clamp);
  let since = f;
  let digit: number | null = null;
  const zoomed = abs >= B(CARD_PUNCH);
  if (zoomed) since = abs - B(CARD_PUNCH);
  for (const c of COUNTDOWN) {
    if (abs >= B(c.beat)) {
      n = mark(m, `tick ${c.n}`) + 3 + (abs - B(c.beat));
      since = abs - B(c.beat);
      digit = c.n;
    }
  }
  const s = (zoomed ? 4.7 : 4.0) * L.zoom;
  const cx = 322, cy = 190;
  const x = L.subject.x, y = L.square ? L.subject.y - 40 : L.subject.y + 40;
  return (
    <AbsoluteFill style={{ background: N.bgDeep }}>
      <AbsoluteFill style={{ transform: `scale(${punch(since, fps, 0.12)})` }}>
        <Shot m={m} n={n} cx={cx} cy={cy} x={x} y={y} scale={s} cropTop={CARD_TOP} fadeRight={fadeR(L)} />
      </AbsoluteFill>
      <Spotlight x={x} y={y} r={560} dark={0.9} />
      {digit !== null ? (
        <div style={{ position: "absolute", right: L.digit.right, top: L.digit.top, fontFamily: HEAVY, fontSize: L.digit.size, lineHeight: 1, color: N.red, transform: `scale(${punch(since, fps, 0.35)})`, transformOrigin: "top right", textShadow: "0 0 80px rgba(217,72,59,.45)" }}>
          {digit}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

// 5. Hard cut on the accent: he bolts with the tab in his mouth.
export const Steal: React.FC<SceneProps> = ({ m, track }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const L = useLayout();
  const n = mark(m, "take") + 4 + f;
  const [hx, hy] = headAt(track, n, 5);
  const s = 7.4 * L.zoom;
  const x = L.subject.x, y = L.subject.y + 80;
  return (
    <AbsoluteFill style={{ background: N.bgDeep }}>
      <AbsoluteFill style={{ transform: `scale(${punch(f, fps, 0.22)})` }}>
        <Shot m={m} n={n} cx={hx} cy={hy + 14} x={x} y={y} scale={s} cropTop={PAGE_TOP} fadeRight={fadeR(L)} />
      </AbsoluteFill>
      <Spotlight x={x} y={y} r={480} />
    </AbsoluteFill>
  );
};

// 6. Close on the notice: the pointer clicks Undo on the accent; then the strip, where the tab pops back.
export const Undo: React.FC<SceneProps> = ({ m }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const L = useLayout();
  const abs = S("undo") + f;
  const click = mark(m, "undo-click");
  const u = abs - B(UNDO);
  const pop = abs - B(UNDO + 2);
  const x = L.subject.x, y = L.subject.y + 60;
  if (pop >= 0) {
    // The tab bar again: the YouTube tab grows back into its slot, its neighbours make room.
    const g = bigBar(L);
    const present = snap(pop, fps);
    const scale = g.scale * punch(pop, fps, 0.08);
    const ty = stripMid(g.top, scale);
    return (
      <AbsoluteFill style={{ background: N.bgDeep }}>
        <TabBar top={g.top} scale={scale} focus={BAR.target * BAR.tabW + (BAR.tabW * present) / 2} atX={g.x} glow={present} present={present} />
        <Spotlight x={g.x} y={ty} r={L.land ? 560 : 460} dark={0.86} />
        <Ring x={g.x} y={ty} f={pop} r={160} />
      </AbsoluteFill>
    );
  }
  // Before the click: near-freeze slow motion into the click frame; after it, real speed.
  // The capture's click frame already shows the restored state, so the approach holds the frame before it.
  const n = u < 0 ? click - 1 + u * 0.08 : click + u;
  const s = (u < 0 ? 4.0 : 4.9) * L.zoom;
  const ucx = m.undoRect.x + m.undoRect.width / 2, ucy = m.undoRect.y + m.undoRect.height / 2;
  const cx = u < 0 ? 335 : ucx - 40, cy = ucy - 10;
  const bx = x + (ucx - cx) * s, by = y + (ucy - cy) * s;
  const travel = interpolate(abs, [S("undo") + 4, B(UNDO) - 2], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  const press = interpolate(u, [-2, 0, 5], [0, 1, 0], clamp);
  return (
    <AbsoluteFill style={{ background: N.bgDeep }}>
      <AbsoluteFill style={{ transform: `scale(${punch(u >= 0 ? u : f, fps, u >= 0 ? 0.2 : 0.12)})`, transformOrigin: `${bx}px ${by}px` }}>
        <Shot m={m} n={n} cx={cx} cy={cy} x={x} y={y} scale={s} cropTop={PAGE_TOP} fadeRight={fadeR(L)} />
        <Ring x={bx} y={by} f={u} r={120} />
        <Cursor x={bx - 12 + (1 - travel) * 260} y={by - 8 + (1 - travel) * 380} press={press} size={L.square || L.land ? 84 : 100} />
      </AbsoluteFill>
      <Spotlight x={x} y={y} r={560} dark={0.88} />
    </AbsoluteFill>
  );
};

/** Pockets alone (alpha cutout) at footage frame n, his head at screen (x, y). */
const Cutout: React.FC<{ m: FootageManifest; track: Track | null; n: number; x: number; y: number; scale: number; flip?: boolean; style?: React.CSSProperties }> = ({ m, track, n, x, y, scale, flip, style }) => {
  const [hx, hy] = headAt(track, n, 3);
  return <Shot m={m} n={n} cx={hx} cy={hy} x={x} y={y} scale={scale} bare flip={flip} style={style} />;
};

// 7a. He sniffs a pinned tab and walks off.
export const Pinned: React.FC<SceneProps> = ({ m, track }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const L = useLayout();
  const len = B(SCENES.pinned[1]) - B(SCENES.pinned[0]);
  const x = L.subject.x, y = L.subject.y;
  // Approach, a sniff (he is still), then off to the left.
  const away = interpolate(f, [len * 0.62, len], [0, 1], { ...clamp, easing: Easing.in(Easing.cubic) });
  const come = interpolate(f, [0, len * 0.3], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const sniff = Math.sin(f * 1.6) * 6 * (f > len * 0.3 && f < len * 0.62 ? 1 : 0);
  const tabW = (L.square || L.land) ? 520 : 620;
  return (
    <AbsoluteFill style={{ background: N.bg, transform: `scale(${punch(f, fps, 0.12)})` }}>
      <Pool x={x} y={y} r={600} />
      <div style={{ position: "absolute", left: x - tabW / 2 + 120, top: y - 110, width: tabW, height: 220, background: "#2a2f38", borderRadius: "40px 40px 0 0", display: "flex", alignItems: "center", gap: 34, padding: "0 50px", boxShadow: "0 30px 60px rgba(0,0,0,.5)" }}>
        <div style={{ width: 84, height: 84, borderRadius: 16, background: "#6b7079" }} />
        <div style={{ fontFamily: MONO, fontWeight: 700, fontSize: 52, color: N.ink }}>Inbox</div>
        <div style={{ marginLeft: "auto" }}><Pin size={78} color={N.red} /></div>
      </div>
      <Cutout m={m} track={track} n={116 + Math.round(f * 0.3)} x={x - 210 - 400 * (1 - come) - 700 * away + sniff} y={y + 10} scale={((L.square || L.land) ? 6.5 : 8) } />
      <Spotlight x={x} y={y} r={(L.square || L.land) ? 520 : 600} dark={0.85} />
    </AbsoluteFill>
  );
};

// 7b. A text field mid-typing; he peeks and ducks back.
export const Typing: React.FC<SceneProps> = ({ m, track }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const L = useLayout();
  const len = B(SCENES.typing[1]) - B(SCENES.typing[0]);
  const x = L.subject.x, y = L.subject.y;
  const text = "Dear team, the Q3 numb";
  const typed = text.slice(0, Math.min(text.length, 8 + Math.floor(f * 0.6)));
  const caret = Math.floor(f / 8) % 2 === 0;
  const peek = interpolate(f, [4, 12, len - 10, len - 2], [0, 1, 1, 0], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  const boxW = L.land ? 820 : L.square ? 900 : 940;
  return (
    <AbsoluteFill style={{ background: N.bg, transform: `scale(${punch(f, fps, 0.12)})` }}>
      <Pool x={x} y={y} r={600} />
      <div style={{ position: "absolute", left: 0, top: 0, width: L.W, height: y + 60, overflow: "hidden" }}>
        <Cutout m={m} track={track} n={96} x={x + boxW * 0.28} y={y + 120 - 260 * peek} scale={(L.square || L.land) ? 6.5 : 8} />
      </div>
      <div style={{ position: "absolute", left: x - boxW / 2, top: y - 20, width: boxW, height: 190, background: "#1d2128", border: `4px solid ${N.red}`, borderRadius: 22, display: "flex", alignItems: "center", padding: "0 40px", fontFamily: MONO, fontWeight: 700, fontSize: 54, color: N.ink, boxShadow: "0 30px 60px rgba(0,0,0,.5)", whiteSpace: "nowrap", overflow: "hidden" }}>
        {typed}
        <span style={{ display: "inline-block", width: 5, height: 60, background: caret ? N.ink : "transparent", marginLeft: 6 }} />
      </div>
      <Spotlight x={x} y={y} r={(L.square || L.land) ? 560 : 640} dark={0.85} />
    </AbsoluteFill>
  );
};

// 7c. The last tab in the window: a lone tab in the spotlight; he peeks in and backs out.
export const LastTab: React.FC<SceneProps> = ({ m, track }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const L = useLayout();
  const len = B(SCENES.last[1]) - B(SCENES.last[0]);
  const x = L.subject.x - (L.land ? 120 : 0), y = L.subject.y;
  const peek = interpolate(f, [3, 12, len - 10, len - 2], [0, 1, 1, 0], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  const stripW = L.land ? 700 : L.square ? 940 : 1000;
  return (
    <AbsoluteFill style={{ background: N.bg, transform: `scale(${punch(f, fps, 0.12)})` }}>
      <Pool x={x} y={y} r={600} />
      <div style={{ position: "absolute", left: x - stripW / 2, top: y - 90, width: stripW, height: 180, background: "#0e1014", borderRadius: 26, padding: "34px 30px 0", boxShadow: "0 30px 60px rgba(0,0,0,.5)" }}>
        <div style={{ width: 420, height: 146, background: "#2a2f38", borderRadius: "30px 30px 0 0", display: "flex", alignItems: "center", gap: 26, padding: "0 36px" }}>
          <div style={{ width: 64, height: 64, borderRadius: 12, background: "#6b7079" }} />
          <div style={{ fontFamily: MONO, fontWeight: 700, fontSize: 44, color: N.ink }}>Q3 report</div>
        </div>
      </div>
      <Cutout m={m} track={track} n={126} x={x + stripW / 2 - 40 + 360 * (1 - peek)} y={y - 40} scale={L.land ? 5.5 : L.square ? 6.5 : 8} flip />
      <Spotlight x={x} y={y} r={(L.square || L.land) ? 560 : 620} dark={0.85} />
    </AbsoluteFill>
  );
};

// 8. The popup's Working switch flips on the accent; then the spotlight swings to a YouTube tab.
export const Working: React.FC<SceneProps> = ({ m, popup }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const L = useLayout();
  const abs = S("working") + f;
  const flipBeat = SCENES.working[0] + 3;
  const swing = abs - B(SCENES.working[0] + 4);
  const x = L.subject.x, y = L.subject.y;
  const py = y - (L.square || L.land ? 40 : 120);
  if (swing >= 0) {
    // The tab bar: the spotlight swings along it from the left and stops on YouTube, which lights up.
    const g = bigBar(L);
    const scale = g.scale * 0.85;
    const p = interpolate(swing, [0, 9], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
    const lx = g.x - 9 * BAR.tabW * scale * (1 - p);
    const ty = stripMid(g.top, scale);
    const barH = (BAR.stripH + BAR.toolbarH) * scale;
    return (
      <AbsoluteFill style={{ background: N.bgDeep }}>
        <TabBar top={g.top} scale={scale} focus={tabCenter(BAR.target)} atX={g.x} glow={snap(abs - B(SCENES.working[0] + 5), fps)} />
        <Spotlight x={lx} y={ty} r={300} dark={0.94} />
        <CaseTag text="DISTRACTION: YouTube" f={abs - B(SCENES.working[0] + 5)} fps={fps} x={g.x} y={g.top + barH + 60} size={(L.square || L.land) ? 30 : 36} align="center" />
      </AbsoluteFill>
    );
  }
  if (!popup) return null;
  const flip = abs - B(flipBeat);
  const k = Math.max(0, Math.min(popup.frames - 1, flip));
  const s = 6.2 * L.zoom;
  const sw = popup.switchRect;
  const cx = sw.x + 70, cy = sw.y + sw.height / 2;
  const tx = x + (sw.x + 22 - cx) * s, ty = py;
  const travel = interpolate(abs, [S("working") + 4, B(flipBeat) - 2], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  const press = interpolate(flip, [-2, 0, 5], [0, 1, 0], clamp);
  // Landscape: the popup fades out before the caption column instead of running under it.
  const stop = L.captionX - L.captionW / 2 - 30 - (x - cx * s);
  const popFade: React.CSSProperties = L.land ? { maskImage: `linear-gradient(to right, #000 ${stop - 160}px, transparent ${stop}px)`, WebkitMaskImage: `linear-gradient(to right, #000 ${stop - 160}px, transparent ${stop}px)` } : {};
  return (
    <AbsoluteFill style={{ background: N.bgDeep }}>
      <AbsoluteFill style={{ transform: `scale(${punch(flip >= 0 ? flip : f, fps, flip >= 0 ? 0.16 : 0.12)})` }}>
        <Img src={staticFile(`heist-popup/p${String(k).padStart(3, "0")}.png`)} style={{ position: "absolute", left: x - cx * s, top: py - cy * s, width: (popup.size.width / popup.dsf) * s, maxWidth: "none", ...popFade }} />
        <Ring x={tx} y={ty} f={flip} r={120} />
        <Cursor x={tx + (1 - travel) * 300} y={ty + 10 + (1 - travel) * 420} press={press} size={L.square || L.land ? 84 : 100} />
      </AbsoluteFill>
      <Spotlight x={x} y={py} r={470} dark={0.95} />
    </AbsoluteFill>
  );
};

// 9. A lock beside his silhouette.
export const Local: React.FC<SceneProps> = ({ m, track }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const L = useLayout();
  const x = L.subject.x, y = L.subject.y;
  const lockY = (L.square || L.land) ? y - 170 : y - 250;
  const lockIn = snap(f - (B(SCENES.local[0] + 1) - B(SCENES.local[0])), fps);
  return (
    <AbsoluteFill style={{ background: N.bg, transform: `scale(${punch(f, fps, 0.12)})` }}>
      <AbsoluteFill style={{ background: `radial-gradient(circle at ${x - 140}px ${lockY + 100}px, rgba(243,240,234,.30) 0px, rgba(243,240,234,.10) 260px, rgba(243,240,234,0) 480px)` }} />
      <Cutout m={m} track={track} n={88} x={x - 130} y={y - ((L.square || L.land) ? 170 : 260)} scale={(L.square || L.land) ? 6 : 7.5} style={{ filter: "brightness(0.3) saturate(0)" }} />
      <div style={{ position: "absolute", left: x + 90, top: lockY, transform: `scale(${lockIn})`, transformOrigin: "center", filter: "drop-shadow(0 0 40px rgba(217,72,59,.5))" }}>
        <Lock size={(L.square || L.land) ? 190 : 230} />
      </div>
    </AbsoluteFill>
  );
};

// 10. End card: his face, the name, the line in red, the store pill; a punch on the final hit, then the fade.
// Portrait and square stack it; landscape sets the face beside the words.
export const EndCard: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const L = useLayout();
  const at = (k: number) => B(k) - B(ENDCARD);
  const fin = f - at(FINAL);
  const face = snap(f, fps), title = snap(f - at(ENDCARD + 1), fps), sub = snap(f - at(ENDCARD + 2), fps), pill = snap(f - at(ENDCARD + 4), fps);
  const kick = fin >= 0 ? punch(fin, fps, 0.07) : 1;
  const out = interpolate(fin, [0, 15], [0, 1], clamp);
  const sq = L.square, land = L.land;
  const faceSize = land ? 440 : sq ? 270 : 470;
  const glowAt = land ? "28% 50%" : `50% ${sq ? 30 : 33}%`;
  const words = (
    <>
      <div style={{ fontFamily: HEAVY, fontSize: land ? 240 : sq ? 170 : 250, lineHeight: 1, color: N.ink, textTransform: "uppercase", marginTop: land ? 0 : sq ? 34 : 60, letterSpacing: 2, opacity: title > 0 ? 1 : 0, transform: `scale(${punch(f - at(ENDCARD + 1), fps, 0.25)})`, transformOrigin: land ? "left center" : "center" }}>Pockets</div>
      <div style={{ fontFamily: HEAVY, fontSize: land ? 80 : sq ? 64 : 84, lineHeight: 1.1, color: N.red, textTransform: "uppercase", marginTop: land ? 10 : sq ? 8 : 16, letterSpacing: 1.5, opacity: sub > 0 ? 1 : 0, transform: `scale(${punch(f - at(ENDCARD + 2), fps, 0.25)})`, transformOrigin: land ? "left center" : "center" }}>the tab-stealing raccoon</div>
      <div style={{ marginTop: land ? 50 : sq ? 40 : 70, padding: sq ? "16px 40px" : "22px 54px", borderRadius: 999, border: `4px solid ${N.ink}`, fontFamily: MONO, fontWeight: 700, fontSize: sq ? 38 : 48, color: N.ink, opacity: pill > 0 ? 1 : 0, transform: `scale(${punch(f - at(ENDCARD + 4), fps, 0.2)})`, transformOrigin: land ? "left center" : "center" }}>
        Free on the Chrome Web Store
      </div>
    </>
  );
  const icon = <Img src={staticFile("icon-512.png")} style={{ width: faceSize, height: faceSize, flexShrink: 0, transform: `scale(${punch(f, fps, 0.3) * face})`, filter: "drop-shadow(0 30px 60px rgba(0,0,0,.6))" }} />;
  return (
    <AbsoluteFill style={{ background: N.bg }}>
      <AbsoluteFill style={{ background: `radial-gradient(circle at ${glowAt}, rgba(255,244,225,.13) 0px, rgba(255,244,225,0) ${land ? 640 : sq ? 520 : 760}px)` }} />
      {land ? (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 90, transform: `scale(${kick})` }}>
          {icon}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>{words}</div>
        </AbsoluteFill>
      ) : (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", transform: `scale(${kick})`, paddingBottom: sq ? 20 : 120 }}>
          {icon}
          {words}
        </AbsoluteFill>
      )}
      <AbsoluteFill style={{ background: "#000", opacity: out }} />
    </AbsoluteFill>
  );
};
