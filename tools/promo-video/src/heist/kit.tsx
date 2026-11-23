// Building blocks for the heist cut: the night palette, bundled fonts, the footage camera, the spotlight, captions,
// the case-file tag, the corner countdown, zoom punches and the whip-pan's motion blur.
import React from "react";
import { AbsoluteFill, Img, continueRender, delayRender, spring, staticFile, useVideoConfig } from "remotion";
import "@fontsource/anton/400.css";
import "@fontsource/space-mono/700.css";
import type { FootageManifest } from "../types";

export const N = {
  bg: "#141518",
  bgDeep: "#0b0c0e",
  ink: "#f3f0ea",
  dim: "#8b8f98",
  red: "#d9483b",
  line: "#2a2c31",
};
export const HEAVY = '"Anton", Impact, sans-serif';
export const MONO = '"Space Mono", ui-monospace, monospace';

// Block rendering until both bundled fonts are ready, so no frame or still falls back to a system face.
const fontHandle = typeof document !== "undefined" ? delayRender("heist fonts") : null;
if (typeof document !== "undefined") {
  Promise.all([document.fonts.load('400 100px "Anton"'), document.fonts.load('700 30px "Space Mono"')])
    .then(() => continueRender(fontHandle!))
    .catch(() => continueRender(fontHandle!));
}

/** Layout of the frame: portrait 1080x1920 or square 1080x1080. Positions are given as fractions of the frame. */
export function useLayout() {
  const { width: W, height: H } = useVideoConfig();
  const square = H < W * 1.2;
  return {
    W, H, square,
    /** Where the subject (Pockets, the card, the tab) sits on screen. */
    subject: { x: W * 0.5, y: square ? H * 0.38 : H * 0.36 },
    /** Footage scale multiplier: square frames are shorter, so the camera sits a little wider. */
    zoom: square ? 0.8 : 1,
    /** Centre line of the caption block. */
    captionY: square ? H * 0.79 : H * 0.72,
    captionSize: square ? 108 : 158,
  };
}

/** A fast, overshoot-free snap: 0 to 1 in about five frames. */
export const snap = (f: number, fps: number) => (f < 0 ? 0 : spring({ frame: f, fps, config: { damping: 26, stiffness: 520, mass: 0.6 } }));
/** Zoom punch: a scale that snaps from `amount` above 1 down to 1 just after frame 0. */
export const punch = (f: number, fps: number, amount = 0.16) => 1 + amount * (1 - snap(f, fps));

export interface Track { frames: number; head: ([number, number] | null)[] }

/** Smoothed head position (CSS px) at footage frame n; gaps take the nearest tracked frame. */
export function headAt(track: Track | null, n: number, win = 4): [number, number] {
  if (!track) return [240, 300];
  let sx = 0, sy = 0, c = 0;
  for (let k = n - win; k <= n + win; k++) {
    const h = track.head[Math.max(0, Math.min(track.frames - 1, k))];
    if (h) { sx += h[0]; sy += h[1]; c++; }
  }
  if (c) return [sx / c, sy / c];
  for (let d = 1; d < track.frames; d++) {
    const h = track.head[n - d] ?? track.head[n + d];
    if (h) return h;
  }
  return [240, 300];
}

/**
 * The camera on the captured page: footage frame n, with the CSS point (cx, cy) placed at screen (x, y) and
 * `scale` screen px per CSS px. `bare` uses the alpha cutout capture (Pockets alone). `blur` is horizontal motion blur.
 */
export const Shot: React.FC<{
  m: FootageManifest; n: number; cx: number; cy: number; x: number; y: number; scale: number;
  bare?: boolean; blur?: number; style?: React.CSSProperties;
}> = ({ m, n, cx, cy, x, y, scale, bare, blur = 0, style }) => {
  const k = Math.max(0, Math.min(m.frames - 1, Math.round(n)));
  const cssW = m.size.width / m.dsf;
  const id = `mb${Math.round(blur)}`;
  return (
    <>
      {blur > 0.5 ? (
        <svg width={0} height={0} style={{ position: "absolute" }}>
          <filter id={id} x="-20%" y="0" width="140%" height="100%">
            <feGaussianBlur stdDeviation={`${blur} 0`} />
          </filter>
        </svg>
      ) : null}
      <Img
        src={staticFile(`footage/${bare ? "heist-bare" : "heist"}/f${String(k).padStart(4, "0")}.png`)}
        style={{
          position: "absolute", left: x - cx * scale, top: y - cy * scale, width: cssW * scale, maxWidth: "none",
          filter: blur > 0.5 ? `url(#${id})` : undefined, ...style,
        }}
      />
    </>
  );
};

/** Darkness everywhere but a soft pool of light at (x, y) with radius r; plus a frame vignette. */
export const Spotlight: React.FC<{ x: number; y: number; r: number; dark?: number }> = ({ x, y, r, dark = 0.93 }) => (
  <AbsoluteFill
    style={{
      background: `radial-gradient(circle at ${x}px ${y}px, rgba(11,12,14,0) 0px, rgba(11,12,14,0) ${r * 0.45}px, rgba(11,12,14,${dark * 0.62}) ${r}px, rgba(11,12,14,${dark}) ${r * 1.75}px)`,
      pointerEvents: "none",
    }}
  />
);

/** A soft warm pool of light under the subject, drawn behind the footage's edges (reads as the spotlight's floor). */
export const Pool: React.FC<{ x: number; y: number; r: number }> = ({ x, y, r }) => (
  <AbsoluteFill style={{ background: `radial-gradient(circle at ${x}px ${y}px, rgba(255,244,225,.10) 0px, rgba(255,244,225,0) ${r}px)` }} />
);

/** One caption row; *word* renders red. */
export const Row: React.FC<{ text: string; size: number; f: number; fps: number }> = ({ text, size, f, fps }) => {
  if (f < 0) return null;
  const parts = text.split(/(\*[^*]+\*)/).filter(Boolean);
  const s = punch(f, fps, 0.28);
  return (
    <div
      style={{
        fontFamily: HEAVY, fontSize: size, lineHeight: 1.0, color: N.ink, textTransform: "uppercase", letterSpacing: 1,
        textAlign: "center", whiteSpace: "nowrap", transform: `scale(${s})`,
        textShadow: "0 6px 0 rgba(0,0,0,.55), 0 0 40px rgba(0,0,0,.85)",
      }}
    >
      {parts.map((p, i) => (p.startsWith("*") ? <span key={i} style={{ color: N.red }}>{p.slice(1, -1)}</span> : <span key={i}>{p}</span>))}
    </div>
  );
};

/** Fit a row into the frame width: Anton caps run about 0.47 em per character. */
export const fit = (rows: string[], size: number, W: number) => {
  const longest = Math.max(...rows.map((r) => r.replace(/\*/g, "").length));
  return Math.min(size, (W - 110) / (longest * 0.47));
};

/** The small monospace case-file tag, e.g. TARGET: YouTube · IDLE 2 DAYS. */
export const CaseTag: React.FC<{ text: string; f: number; fps: number; x: number; y: number; size?: number; align?: "left" | "center" }> = ({ text, f, fps, x, y, size = 30, align = "left" }) => {
  if (f < 0) return null;
  const chars = Math.min(text.length, Math.floor(f * 3) + 1); // types on fast
  return (
    <div
      style={{
        position: "absolute", left: x, top: y, transform: `${align === "center" ? "translateX(-50%) " : ""}scale(${punch(f, fps, 0.12)})`,
        transformOrigin: "left center", fontFamily: MONO, fontWeight: 700, fontSize: size, letterSpacing: 2, color: N.ink,
        padding: `${size * 0.35}px ${size * 0.6}px`, border: `3px solid ${N.red}`, background: "rgba(11,12,14,.78)", whiteSpace: "nowrap",
      }}
    >
      <span style={{ color: N.red }}>■ </span>
      {text.slice(0, chars)}
    </div>
  );
};

/** A plain white arrow pointer. */
export const Cursor: React.FC<{ x: number; y: number; size?: number; press?: number }> = ({ x, y, size = 90, press = 0 }) => (
  <svg width={size} height={size * 1.4} viewBox="0 0 20 28" style={{ position: "absolute", left: x, top: y, transform: `scale(${1 - 0.15 * press})`, transformOrigin: "0 0", filter: "drop-shadow(0 6px 10px rgba(0,0,0,.6))" }}>
    <path d="M1 1 L1 22 L6.5 17 L10 26 L13.5 24.5 L10 16 L18 16 Z" fill="#fff" stroke="#111" strokeWidth="1.4" strokeLinejoin="round" />
  </svg>
);

/** Expanding red ring (a click, a pop). */
export const Ring: React.FC<{ x: number; y: number; f: number; r?: number }> = ({ x, y, f, r = 90 }) => {
  if (f < 0 || f > 14) return null;
  const t = f / 14;
  const rr = r * (0.4 + 1.1 * t);
  return <div style={{ position: "absolute", left: x - rr, top: y - rr, width: rr * 2, height: rr * 2, borderRadius: "50%", border: `${10 * (1 - t) + 2}px solid ${N.red}`, opacity: 1 - t }} />;
};

export const Lock: React.FC<{ size: number; color?: string }> = ({ size, color = N.red }) => (
  <svg width={size} height={size * 1.2} viewBox="0 0 50 60">
    <path d="M13 26 V17 a12 12 0 0 1 24 0 V26" fill="none" stroke={color} strokeWidth="6" strokeLinecap="round" />
    <rect x="5" y="25" width="40" height="32" rx="6" fill={color} />
    <circle cx="25" cy="39" r="4.5" fill={N.bgDeep} />
    <rect x="23" y="40" width="4" height="9" rx="2" fill={N.bgDeep} />
  </svg>
);

export const Pin: React.FC<{ size: number; color?: string }> = ({ size, color = N.ink }) => (
  <svg width={size} height={size} viewBox="0 0 24 24">
    <path d="M15 3 L21 9 L18.5 9.8 L14.6 13.7 L15 18 L13 20 L9.5 16.5 L4 22 L2 22 L2 20 L7.5 14.5 L4 11 L6 9 L10.3 9.4 L14.2 5.5 Z" fill={color} />
  </svg>
);
