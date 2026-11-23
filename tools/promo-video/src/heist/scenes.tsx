// The heist cut's scenes. Each gets its frame relative to its own start (Remotion Sequence) plus the absolute beat
// frames it needs from the timeline, so footage frames are pinned to beats: the card's own ticks land on the giant
// countdown digits, the take lands on the steal beat and the Undo click lands on the Undo beat.
import React from "react";
import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { FootageManifest, PopupManifest } from "../types";
import { B, COUNTDOWN, ENDCARD, FINAL, GRAB, SCENES, STEAL, UNDO } from "./timeline";
import { CaseTag, Cursor, HEAVY, Lock, MONO, N, Pin, Pool, Ring, Shot, Spotlight, Track, headAt, punch, snap, useLayout } from "./kit";

export interface SceneProps { m: FootageManifest; track: Track | null; popup: PopupManifest | null }

const mark = (m: FootageManifest, name: string): number => {
  const hit = m.marks.find((x) => x.event === name);
  if (!hit) throw new Error(`footage manifest has no "${name}" mark`);
  return hit.frame;
};
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
/** Scene start frame. */
const S = (name: keyof typeof SCENES) => B(SCENES[name][0]);
/** The YouTube tab in the strip: tab 19 of 47 (strip padding 8 px left, 100 px right, 480 px wide). */
const TAB = { x: 8 + 19.5 * (372 / 47), y: 26 };

// 1. Black, then the spotlight snaps on: Pockets' face, tight, just under the crammed tab strip.
export const Spotlit: React.FC<SceneProps> = ({ m, track }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const L = useLayout();
  const n = 138 + f; // perched under the strip, eyes on the tabs (the climb itself is scene 3)
  const [hx, hy] = headAt(track, Math.round(n), 6);
  // Low in the frame so the crammed strip shows above him.
  const s = L.square ? 4.6 : 7.6;
  // Head to the right so the warning card (to his lower right) stays off-frame; his body and tail cross the frame.
  const x = L.W * (L.square ? 0.84 : 0.78), y = L.square ? L.H * 0.42 : L.subject.y + 80;
  const iris = snap(f, fps);
  return (
    <AbsoluteFill style={{ background: N.bgDeep }}>
      <AbsoluteFill style={{ transform: `scale(${punch(f, fps, 0.1)})` }}>
        <Shot m={m} n={n} cx={hx} cy={hy} x={x} y={y} scale={s} />
      </AbsoluteFill>
      <Spotlight x={x - 160} y={y - (L.square ? 120 : 200)} r={30 + (L.square ? 500 : 640) * iris} dark={0.95} />
    </AbsoluteFill>
  );
};

// 2. Whip-pan along the tab strip; it lands on the one that glows.
export const Whip: React.FC<SceneProps> = ({ m }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const L = useLayout();
  const n = 176 + f;
  const s = 11 * L.zoom;
  const p = interpolate(f, [0, 8], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const p0 = interpolate(f - 1, [0, 8], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const span = 300;
  const cx = TAB.x + span * (1 - p);
  const blur = Math.abs(p - p0) * span * s * 0.12;
  const drift = interpolate(f, [8, 60], [0, -6], clamp);
  const x = L.subject.x, y = L.subject.y - 120;
  const glowAt = B(SCENES.whip[0] + 1) - B(SCENES.whip[0]); // lands with "is mine."
  const glow = snap(f - glowAt, fps);
  return (
    <AbsoluteFill style={{ background: N.bgDeep }}>
      <Shot m={m} n={n} cx={cx + drift} cy={TAB.y} x={x} y={y} scale={s} blur={blur} />
      <Spotlight x={x} y={y} r={220 + 140 * glow} dark={0.9} />
      {glow > 0 ? (
        <div style={{ position: "absolute", left: x - 70, top: y - 150, width: 140, height: 300, border: `6px solid ${N.red}`, borderRadius: 18, boxShadow: `0 0 60px ${N.red}`, opacity: glow, transform: `scale(${punch(f - glowAt, fps, 0.4)})` }} />
      ) : null}
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
        <Shot m={m} n={n} cx={hx} cy={hy + 20} x={x} y={y} scale={s} />
      </AbsoluteFill>
      <Spotlight x={x} y={y} r={470} />
      <CaseTag text="TARGET: YouTube · IDLE 2 DAYS" f={f - tagAt} fps={fps} x={L.W / 2} y={L.square ? 60 : 210} size={L.square ? 28 : 34} align="center" />
    </AbsoluteFill>
  );
};

// 4. The warning card; a giant corner countdown 5 · 4 · 3 on the beats, each a jump cut to the card's own tick.
export const Warning: React.FC<SceneProps> = ({ m }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const L = useLayout();
  const t0 = S("warning");
  const abs = t0 + f;
  const card = mark(m, "card-shown");
  const take = mark(m, "take");
  // Footage: the card appearing, then jumps so the card reads 5, 4, 3 exactly when the corner digit does.
  let n = card + 2 + f;
  let since = f;
  let digit: number | null = null;
  for (const c of COUNTDOWN) {
    if (abs >= B(c.beat)) {
      n = mark(m, `tick ${c.n}`) + 3 + (abs - B(c.beat));
      since = abs - B(c.beat);
      digit = c.n;
    }
  }
  const frozen = abs >= B(GRAB);
  if (frozen) { n = take - 3; since = abs - B(GRAB); digit = null; }
  const zoomed = abs >= B(COUNTDOWN[0].beat);
  const s = (zoomed ? 4.7 : 4.0) * L.zoom * (frozen ? 1.5 : 1);
  const cx = frozen ? 175 : 322, cy = frozen ? 118 : 190;
  const x = L.subject.x, y = L.square ? L.subject.y - 40 : L.subject.y + 40;
  return (
    <AbsoluteFill style={{ background: N.bgDeep }}>
      <AbsoluteFill style={{ transform: `scale(${punch(since, fps, 0.12)})` }}>
        <Shot m={m} n={n} cx={cx} cy={cy} x={x} y={y} scale={s} style={frozen ? { filter: "saturate(1.2) contrast(1.1)" } : undefined} />
      </AbsoluteFill>
      <Spotlight x={x} y={y} r={frozen ? 420 : 560} dark={0.9} />
      {frozen ? <AbsoluteFill style={{ background: N.red, opacity: interpolate(since, [0, 4], [0.35, 0], clamp), mixBlendMode: "screen" }} /> : null}
      {digit !== null ? (
        <div style={{ position: "absolute", right: L.square ? 50 : 60, top: L.square ? -40 : 40, fontFamily: HEAVY, fontSize: L.square ? 380 : 560, lineHeight: 1, color: N.red, transform: `scale(${punch(since, fps, 0.35)})`, transformOrigin: "top right", textShadow: "0 0 80px rgba(217,72,59,.45)" }}>
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
        <Shot m={m} n={n} cx={hx} cy={hy + 14} x={x} y={y} scale={s} />
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
    // The strip again, with YouTube back in its slot.
    const s = 11 * L.zoom;
    return (
      <AbsoluteFill style={{ background: N.bgDeep }}>
        <AbsoluteFill style={{ transform: `scale(${punch(pop, fps, 0.18)})` }}>
          <Shot m={m} n={click + 4 + u} cx={TAB.x} cy={TAB.y} x={x} y={y - 180} scale={s} />
        </AbsoluteFill>
        <Spotlight x={x} y={y - 180} r={330} dark={0.9} />
        <div style={{ position: "absolute", left: x - 70, top: y - 330, width: 140, height: 300, border: `6px solid ${N.red}`, borderRadius: 18, boxShadow: `0 0 60px ${N.red}`, transform: `scale(${punch(pop, fps, 0.6)})` }} />
        <Ring x={x} y={y - 180} f={pop} r={160} />
      </AbsoluteFill>
    );
  }
  // Before the click: near-freeze slow motion into the click frame; after it, real speed.
  const n = u < 0 ? click + u * 0.08 : click + u;
  const s = (u < 0 ? 4.0 : 4.9) * L.zoom;
  const ucx = m.undoRect.x + m.undoRect.width / 2, ucy = m.undoRect.y + m.undoRect.height / 2;
  const cx = u < 0 ? 335 : ucx - 40, cy = ucy - 10;
  const bx = x + (ucx - cx) * s, by = y + (ucy - cy) * s;
  const travel = interpolate(abs, [S("undo") + 4, B(UNDO) - 2], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  const press = interpolate(u, [-2, 0, 5], [0, 1, 0], clamp);
  return (
    <AbsoluteFill style={{ background: N.bgDeep }}>
      <AbsoluteFill style={{ transform: `scale(${punch(u >= 0 ? u : f, fps, u >= 0 ? 0.2 : 0.12)})`, transformOrigin: `${bx}px ${by}px` }}>
        <Shot m={m} n={n} cx={cx} cy={cy} x={x} y={y} scale={s} />
        <Ring x={bx} y={by} f={u} r={120} />
        <Cursor x={bx - 12 + (1 - travel) * 260} y={by - 8 + (1 - travel) * 380} press={press} size={L.square ? 80 : 100} />
      </AbsoluteFill>
      <Spotlight x={x} y={y} r={560} dark={0.88} />
    </AbsoluteFill>
  );
};

/** Pockets alone (alpha cutout) at footage frame n, his head at screen (x, y). */
const Cutout: React.FC<{ m: FootageManifest; track: Track | null; n: number; x: number; y: number; scale: number; style?: React.CSSProperties }> = ({ m, track, n, x, y, scale, style }) => {
  const [hx, hy] = headAt(track, n, 3);
  return <Shot m={m} n={n} cx={hx} cy={hy} x={x} y={y} scale={scale} bare style={style} />;
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
  const tabW = L.square ? 520 : 620;
  return (
    <AbsoluteFill style={{ background: N.bg, transform: `scale(${punch(f, fps, 0.12)})` }}>
      <Pool x={x} y={y} r={600} />
      <div style={{ position: "absolute", left: x - tabW / 2 + 120, top: y - 110, width: tabW, height: 220, background: "#2a2f38", borderRadius: "40px 40px 0 0", display: "flex", alignItems: "center", gap: 34, padding: "0 50px", boxShadow: "0 30px 60px rgba(0,0,0,.5)" }}>
        <div style={{ width: 84, height: 84, borderRadius: 16, background: "#6b7079" }} />
        <div style={{ fontFamily: MONO, fontWeight: 700, fontSize: 52, color: N.ink }}>Inbox</div>
        <div style={{ marginLeft: "auto" }}><Pin size={78} color={N.red} /></div>
      </div>
      <Cutout m={m} track={track} n={116 + Math.round(f * 0.3)} x={x - 210 - 400 * (1 - come) - 700 * away + sniff} y={y + 10} scale={(L.square ? 6.5 : 8) } />
      <Spotlight x={x} y={y} r={L.square ? 520 : 600} dark={0.85} />
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
  const boxW = L.square ? 900 : 940;
  return (
    <AbsoluteFill style={{ background: N.bg, transform: `scale(${punch(f, fps, 0.12)})` }}>
      <Pool x={x} y={y} r={600} />
      <div style={{ position: "absolute", left: 0, top: 0, width: L.W, height: y + 60, overflow: "hidden" }}>
        <Cutout m={m} track={track} n={96} x={x + boxW * 0.28} y={y + 120 - 260 * peek} scale={L.square ? 6.5 : 8} />
      </div>
      <div style={{ position: "absolute", left: x - boxW / 2, top: y - 20, width: boxW, height: 190, background: "#1d2128", border: `4px solid ${N.red}`, borderRadius: 22, display: "flex", alignItems: "center", padding: "0 40px", fontFamily: MONO, fontWeight: 700, fontSize: 54, color: N.ink, boxShadow: "0 30px 60px rgba(0,0,0,.5)", whiteSpace: "nowrap", overflow: "hidden" }}>
        {typed}
        <span style={{ display: "inline-block", width: 5, height: 60, background: caret ? N.ink : "transparent", marginLeft: 6 }} />
      </div>
      <Spotlight x={x} y={y} r={L.square ? 560 : 640} dark={0.85} />
    </AbsoluteFill>
  );
};

// 7c. The last tab in the window: a lone tab in the spotlight; he peeks in and backs out.
export const LastTab: React.FC<SceneProps> = ({ m, track }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const L = useLayout();
  const len = B(SCENES.last[1]) - B(SCENES.last[0]);
  const x = L.subject.x, y = L.subject.y;
  const peek = interpolate(f, [3, 12, len - 10, len - 2], [0, 1, 1, 0], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  const stripW = L.square ? 940 : 1000;
  return (
    <AbsoluteFill style={{ background: N.bg, transform: `scale(${punch(f, fps, 0.12)})` }}>
      <Pool x={x} y={y} r={600} />
      <div style={{ position: "absolute", left: x - stripW / 2, top: y - 90, width: stripW, height: 180, background: "#0e1014", borderRadius: 26, padding: "34px 30px 0", boxShadow: "0 30px 60px rgba(0,0,0,.5)" }}>
        <div style={{ width: 420, height: 146, background: "#2a2f38", borderRadius: "30px 30px 0 0", display: "flex", alignItems: "center", gap: 26, padding: "0 36px" }}>
          <div style={{ width: 64, height: 64, borderRadius: 12, background: "#6b7079" }} />
          <div style={{ fontFamily: MONO, fontWeight: 700, fontSize: 44, color: N.ink }}>Q3 report</div>
        </div>
      </div>
      <Cutout m={m} track={track} n={126} x={x + stripW / 2 - 40 + 360 * (1 - peek)} y={y - 40} scale={L.square ? 6.5 : 8} style={{ transform: "scaleX(-1)" }} />
      <Spotlight x={x} y={y} r={L.square ? 560 : 620} dark={0.85} />
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
  const py = y - (L.square ? 40 : 120);
  if (swing >= 0) {
    const s = 11 * L.zoom;
    const p = interpolate(swing, [0, 9], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
    const lx = x + (40 - TAB.x) * s * (1 - p);
    return (
      <AbsoluteFill style={{ background: N.bgDeep }}>
        <Shot m={m} n={20 + swing} cx={TAB.x} cy={TAB.y + 10} x={x} y={y - 60} scale={s} />
        <Spotlight x={lx} y={y - 160} r={260} dark={0.94} />
        <CaseTag text="DISTRACTION: YouTube" f={abs - B(SCENES.working[0] + 5)} fps={fps} x={x} y={y + 120} size={L.square ? 30 : 36} align="center" />
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
  return (
    <AbsoluteFill style={{ background: N.bgDeep }}>
      <AbsoluteFill style={{ transform: `scale(${punch(flip >= 0 ? flip : f, fps, flip >= 0 ? 0.16 : 0.12)})` }}>
        <Img src={staticFile(`heist-popup/p${String(k).padStart(3, "0")}.png`)} style={{ position: "absolute", left: x - cx * s, top: py - cy * s, width: (popup.size.width / popup.dsf) * s, maxWidth: "none" }} />
        <Ring x={tx} y={ty} f={flip} r={120} />
        <Cursor x={tx + (1 - travel) * 300} y={ty + 10 + (1 - travel) * 420} press={press} size={L.square ? 80 : 100} />
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
  const lockY = L.square ? y - 170 : y - 250;
  const lockIn = snap(f - (B(SCENES.local[0] + 1) - B(SCENES.local[0])), fps);
  return (
    <AbsoluteFill style={{ background: N.bg, transform: `scale(${punch(f, fps, 0.12)})` }}>
      <AbsoluteFill style={{ background: `radial-gradient(circle at ${x - 140}px ${lockY + 100}px, rgba(243,240,234,.30) 0px, rgba(243,240,234,.10) 260px, rgba(243,240,234,0) 480px)` }} />
      <Cutout m={m} track={track} n={88} x={x - 130} y={y - (L.square ? 170 : 260)} scale={L.square ? 6 : 7.5} style={{ filter: "brightness(0.3) saturate(0)" }} />
      <div style={{ position: "absolute", left: x + 90, top: lockY, transform: `scale(${lockIn})`, transformOrigin: "center", filter: "drop-shadow(0 0 40px rgba(217,72,59,.5))" }}>
        <Lock size={L.square ? 190 : 230} />
      </div>
    </AbsoluteFill>
  );
};

// 10. End card: his face, the name, the line in red, the store pill; a punch on the final hit, then the fade.
export const EndCard: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const L = useLayout();
  const at = (k: number) => B(k) - B(ENDCARD);
  const fin = f - at(FINAL);
  const face = snap(f, fps), title = snap(f - at(ENDCARD + 1), fps), sub = snap(f - at(ENDCARD + 2), fps), pill = snap(f - at(ENDCARD + 4), fps);
  const kick = fin >= 0 ? punch(fin, fps, 0.07) : 1;
  const out = interpolate(fin, [0, 15], [0, 1], clamp);
  const sq = L.square;
  const faceSize = sq ? 270 : 470;
  return (
    <AbsoluteFill style={{ background: N.bg }}>
      <AbsoluteFill style={{ background: `radial-gradient(circle at 50% ${sq ? 30 : 33}%, rgba(255,244,225,.13) 0px, rgba(255,244,225,0) ${sq ? 520 : 760}px)` }} />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", transform: `scale(${kick})`, paddingBottom: sq ? 20 : 120 }}>
        <Img src={staticFile("icon-512.png")} style={{ width: faceSize, height: faceSize, transform: `scale(${punch(f, fps, 0.3) * face})`, filter: "drop-shadow(0 30px 60px rgba(0,0,0,.6))" }} />
        <div style={{ fontFamily: HEAVY, fontSize: sq ? 170 : 250, lineHeight: 1, color: N.ink, textTransform: "uppercase", marginTop: sq ? 34 : 60, letterSpacing: 2, opacity: title > 0 ? 1 : 0, transform: `scale(${punch(f - at(ENDCARD + 1), fps, 0.25)})` }}>Pockets</div>
        <div style={{ fontFamily: HEAVY, fontSize: sq ? 64 : 84, lineHeight: 1.1, color: N.red, textTransform: "uppercase", marginTop: sq ? 8 : 16, letterSpacing: 1.5, opacity: sub > 0 ? 1 : 0, transform: `scale(${punch(f - at(ENDCARD + 2), fps, 0.25)})` }}>the tab-stealing raccoon</div>
        <div style={{ marginTop: sq ? 40 : 70, padding: sq ? "16px 40px" : "22px 54px", borderRadius: 999, border: `4px solid ${N.ink}`, fontFamily: MONO, fontWeight: 700, fontSize: sq ? 38 : 48, color: N.ink, opacity: pill > 0 ? 1 : 0, transform: `scale(${punch(f - at(ENDCARD + 4), fps, 0.2)})` }}>
          Free on the Chrome Web Store
        </div>
      </AbsoluteFill>
      <AbsoluteFill style={{ background: "#000", opacity: out }} />
    </AbsoluteFill>
  );
};
