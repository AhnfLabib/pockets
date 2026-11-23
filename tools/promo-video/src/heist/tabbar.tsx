// A Chrome-style tab bar, drawn as vectors (SVG) so it is crisp at any size: a short strip of 47 narrow tabs (each a
// favicon and a title that fades out where it truncates, as Chrome does when overcrowded), one active tab joined to
// the toolbar below it, and the target, YouTube, whose favicon is the only coloured one and which can glow red.
// The scenes move a camera over it (which world x sits at which screen x, and how large), never a bitmap.
import React from "react";
import { useVideoConfig } from "remotion";
import { N, UI } from "./kit";

/** World geometry, in bar units (1 unit = 1 screen px at scale 1). */
export const BAR = {
  tabW: 100,
  stripH: 60,
  tabTop: 10,
  toolbarH: 60,
  tabs: 47,
  /** The target (YouTube) and the active tab (the page Pockets is on). */
  target: 19,
  active: 21,
} as const;

/** World x of a tab's centre. */
export const tabCenter = (i: number) => i * BAR.tabW + BAR.tabW / 2;

export const TITLES = [
  "Inbox (12)", "Calendar", "Q2 planning", "Standup notes", "Jira board", "Pull request #418", "Figma - Onboarding",
  "Stack Overflow", "MDN Web Docs", "Flight deals", "Hotel booking", "Weather", "Recipes", "Amazon cart", "News",
  "Wikipedia", "Maps", "Spotify", "Reddit", "YouTube", "Slack", "Q3 report draft", "Analytics", "Notion",
  "Sheets - budget", "Design review", "GitHub", "Hacker News", "Docs", "Drive", "Translate", "Podcast",
  "Gym schedule", "Bank", "Shopping list", "LinkedIn", "Course: SQL", "Meetup", "Rental listing", "Pizza menu",
  "Tickets", "Blog draft", "Twitch", "Dentist", "Kanban", "Invoices", "Read later",
];

// Chrome's dark theme, cooled slightly to sit in the night palette.
const C = {
  frame: "#17181b",
  toolbar: "#2a2c31",
  omnibox: "#17181b",
  sep: "#3b3e45",
  title: "#9aa0a6",
  titleActive: "#e8eaed",
  glowTab: "#33201f",
};
/** Muted favicon tones: desaturated, so the red target stays the only accent. */
const MUTED = ["#4d525b", "#575c66", "#4a5550", "#5a5361", "#5d5750", "#4f5662", "#545a52", "#5b5559"];

/** A favicon, `s` units square, top-left at (x, y). The target gets YouTube's red play button. */
const Favicon: React.FC<{ i: number; x: number; y: number; s: number }> = ({ i, x, y, s }) => {
  if (i === BAR.target) {
    return (
      <g>
        <rect x={x} y={y + s * 0.14} width={s} height={s * 0.72} rx={s * 0.2} fill={N.red} />
        <path d={`M ${x + s * 0.4} ${y + s * 0.33} L ${x + s * 0.68} ${y + s * 0.5} L ${x + s * 0.4} ${y + s * 0.67} Z`} fill="#fff" />
      </g>
    );
  }
  const fill = MUTED[(i * 5) % MUTED.length];
  const round = i % 3 === 1;
  return (
    <g>
      {round ? <circle cx={x + s / 2} cy={y + s / 2} r={s / 2} fill={fill} /> : <rect x={x} y={y} width={s} height={s} rx={s * 0.22} fill={fill} />}
      <text x={x + s / 2} y={y + s * 0.72} textAnchor="middle" fontFamily={UI} fontWeight={600} fontSize={s * 0.6} fill="#c9ccd2" fillOpacity={0.75}>
        {TITLES[i][0]}
      </text>
    </g>
  );
};

/** The active tab's outline: rounded top corners and the flared foot that joins the toolbar. */
const activePath = (x: number, w: number) => {
  const t = BAR.tabTop, b = BAR.stripH, r = 9;
  return `M ${x - r} ${b} Q ${x} ${b} ${x} ${b - r} L ${x} ${t + r} Q ${x} ${t} ${x + r} ${t} L ${x + w - r} ${t} Q ${x + w} ${t} ${x + w} ${t + r} L ${x + w} ${b - r} Q ${x + w} ${b} ${x + w + r} ${b} Z`;
};

export interface TabBarProps {
  /** Screen y of the top of the tab strip. */
  top: number;
  /** Screen px per bar unit. */
  scale: number;
  /** The world x placed at screen x `atX`. */
  focus: number;
  atX: number;
  /** 0..1: the target tab's red glow. */
  glow?: number;
  /** 0..1: the target tab's width (0 = gone, it was taken; animating to 1 = it pops back). */
  present?: number;
  /** Horizontal motion blur, in screen px. */
  blur?: number;
  /** Draw the toolbar (with the address box) under the strip. */
  toolbar?: boolean;
  /** Text in the address box. */
  url?: string;
  opacity?: number;
}

/** The tab bar, full frame width, drawn crisp at `scale` (no bitmap scaling). */
export const TabBar: React.FC<TabBarProps> = ({ top, scale, focus, atX, glow = 0, present = 1, blur = 0, toolbar = true, url = "docs.example.com/q3-report-draft", opacity = 1 }) => {
  const { width: W } = useVideoConfig();
  const height = (BAR.stripH + (toolbar ? BAR.toolbarH : 0)) * scale;
  // Whole-pixel translation at rest, so edges land on the pixel grid.
  const tx = Math.round(atX - focus * scale);
  const ty = Math.round(top);
  const wT = BAR.tabW * present;
  const xOf = (i: number) => (i < BAR.target ? i * BAR.tabW : i === BAR.target ? BAR.target * BAR.tabW : (i - 1) * BAR.tabW + wT);
  const wOf = (i: number) => (i === BAR.target ? wT : BAR.tabW);
  // Only the tabs that can be on screen.
  const lo = Math.max(0, Math.floor((-tx / scale) / BAR.tabW) - 1);
  const hi = Math.min(BAR.tabs - 1, Math.ceil(((W - tx) / scale) / BAR.tabW) + 1);
  const idx: number[] = [];
  for (let i = lo; i <= hi; i++) idx.push(i);
  const fav = 26, pad = 12, gap = 9, font = 19;
  const blurId = `tbblur${Math.round(blur)}`;
  return (
    <svg width={W} height={Math.ceil(height)} viewBox={`0 0 ${W} ${Math.ceil(height)}`} style={{ position: "absolute", left: 0, top: ty, opacity, overflow: "visible" }} shapeRendering="geometricPrecision" textRendering="geometricPrecision">
      <defs>
        {blur > 0.5 ? (
          <filter id={blurId} x="-10%" y="0" width="120%" height="100%">
            <feGaussianBlur stdDeviation={`${blur} 0`} />
          </filter>
        ) : null}
        <filter id="tbglow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation={10 / Math.max(scale, 0.5)} />
        </filter>
        {idx.map((i) => (
          <clipPath key={i} id={`tbclip${i}`}>
            <rect x={xOf(i) + pad + fav + gap} y={0} width={Math.max(0, wOf(i) - pad - fav - gap - (i === BAR.active ? 26 : 8))} height={BAR.stripH} />
          </clipPath>
        ))}
        <linearGradient id="tbfadeF" x1="0" x2="1"><stop offset="0" stopColor={C.frame} stopOpacity={0} /><stop offset="1" stopColor={C.frame} /></linearGradient>
        <linearGradient id="tbfadeA" x1="0" x2="1"><stop offset="0" stopColor={C.toolbar} stopOpacity={0} /><stop offset="1" stopColor={C.toolbar} /></linearGradient>
        <linearGradient id="tbfadeG" x1="0" x2="1"><stop offset="0" stopColor={C.glowTab} stopOpacity={0} /><stop offset="1" stopColor={C.glowTab} /></linearGradient>
      </defs>
      {/* The strip's background spans the frame. */}
      <rect x={0} y={0} width={W} height={BAR.stripH * scale} fill={C.frame} />
      {toolbar ? (
        <g>
          <rect x={0} y={BAR.stripH * scale} width={W} height={BAR.toolbarH * scale} fill={C.toolbar} />
          <rect x={0} y={height - Math.max(1, scale)} width={W} height={Math.max(1, scale)} fill="#000" fillOpacity={0.5} />
        </g>
      ) : null}
      <g transform={`translate(${tx} 0) scale(${scale})`} filter={blur > 0.5 ? `url(#${blurId})` : undefined}>
        {idx.map((i) => {
          const x = xOf(i), w = wOf(i);
          if (w < 1) return null;
          const isA = i === BAR.active, isT = i === BAR.target;
          const sepHidden = isA || i - 1 === BAR.active || (isT && glow > 0.01) || (i - 1 === BAR.target && glow > 0.01);
          const k = isT ? present : 1;
          const tx0 = x + pad + fav + gap;
          const clipW = Math.max(0, w - pad - fav - gap - (isA ? 26 : 8));
          return (
            <g key={i}>
              {!sepHidden && i > 0 ? <rect x={x - 0.75} y={BAR.tabTop + 12} width={1.5} height={BAR.stripH - BAR.tabTop - 24} fill={C.sep} /> : null}
              {isA ? <path d={activePath(x, w)} fill={C.toolbar} /> : null}
              {isT && glow > 0 ? (
                <g opacity={glow}>
                  <rect x={x + 1} y={BAR.tabTop} width={w - 2} height={BAR.stripH - BAR.tabTop - 4} rx={9} fill={N.red} filter="url(#tbglow)" opacity={0.75} />
                  <rect x={x + 1} y={BAR.tabTop} width={w - 2} height={BAR.stripH - BAR.tabTop - 4} rx={9} fill={C.glowTab} stroke={N.red} strokeWidth={2.5} />
                </g>
              ) : null}
              <g transform={k < 1 ? `translate(${x + w / 2} ${BAR.stripH / 2 + 3}) scale(${k}) translate(${-(x + w / 2)} ${-(BAR.stripH / 2 + 3)})` : undefined}>
                <Favicon i={i} x={x + pad} y={BAR.tabTop + (BAR.stripH - BAR.tabTop - fav) / 2} s={fav} />
                {clipW > 2 ? (
                  <g clipPath={`url(#tbclip${i})`}>
                    <text x={tx0} y={BAR.tabTop + (BAR.stripH - BAR.tabTop) / 2 + font * 0.36} fontFamily={UI} fontWeight={isA ? 500 : 400} fontSize={font} fill={isA ? C.titleActive : isT && glow > 0.5 ? "#f3d9d6" : C.title}>
                      {TITLES[i]}
                    </text>
                    <rect x={tx0 + clipW - 18} y={BAR.tabTop + 3} width={18} height={BAR.stripH - BAR.tabTop - 10} fill={`url(#${isA ? "tbfadeA" : isT && glow > 0.5 ? "tbfadeG" : "tbfadeF"})`} />
                  </g>
                ) : null}
                {isA ? (
                  <path d={`M ${x + w - 24} ${BAR.stripH / 2 + 1} l 9 9 m 0 -9 l -9 9`} stroke={C.titleActive} strokeWidth={1.8} strokeLinecap="round" transform={`translate(0 -4)`} />
                ) : null}
              </g>
            </g>
          );
        })}
      </g>
      {toolbar ? (
        // The toolbar stays put while the camera moves along the tabs: back, forward, reload and the address box.
        <g transform={`translate(0 ${BAR.stripH * scale}) scale(${scale})`}>
          {[0, 1, 2].map((j) => (
            <circle key={j} cx={28 + j * 40} cy={BAR.toolbarH / 2} r={7} fill="none" stroke="#6b7079" strokeWidth={2} />
          ))}
          <rect x={150} y={10} width={W / scale - 150 - 24} height={BAR.toolbarH - 20} rx={(BAR.toolbarH - 20) / 2} fill={C.omnibox} />
          <text x={176} y={BAR.toolbarH / 2 + 7} fontFamily={UI} fontSize={19} fill="#a5abb3">{url}</text>
        </g>
      ) : null}
    </svg>
  );
};
