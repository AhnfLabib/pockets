import React from "react";
import { Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { C, FONT } from "../theme";

/**
 * A caption block for the intro: a headline and an optional second line, rising in at `from` and lifting out before
 * `to`. `instant` shows it fully on its first frame (the video's frame 0 doubles as the muted-autoplay poster).
 */
export const Headline: React.FC<{
  text: string;
  sub?: string;
  from?: number;
  to?: number;
  subDelay?: number;
  size?: number;
  subSize?: number;
  instant?: boolean;
  color?: string;
  subColor?: string;
  align?: "center" | "left";
}> = ({ text, sub, from = 0, to, subDelay = 6, size = 92, subSize = 60, instant = false, color = C.ink, subColor = C.accent, align = "center" }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (frame < from || (to !== undefined && frame >= to)) return null;
  const rise = (d: number) => (instant && d === 0 ? 1 : spring({ frame: frame - from - d, fps, config: { damping: 200 }, durationInFrames: 14 }));
  const exit = to === undefined ? 0 : interpolate(frame, [to - 8, to], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.in(Easing.cubic) });
  const a = rise(0);
  const b = rise(subDelay);
  const line = (k: number): React.CSSProperties => ({ opacity: k * (1 - exit), transform: `translateY(${(1 - k) * 30 - exit * 20}px)` });
  return (
    <div style={{ fontFamily: FONT, textAlign: align, letterSpacing: "-0.025em", textWrap: "balance" }}>
      <div style={{ fontSize: size, fontWeight: 800, lineHeight: 1.06, color, ...line(a) }}>{text}</div>
      {sub ? <div style={{ fontSize: subSize, fontWeight: 700, lineHeight: 1.15, color: subColor, marginTop: 22, whiteSpace: "pre-line", ...line(b) }}>{sub}</div> : null}
    </div>
  );
};
