import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig, Easing } from "remotion";
import { C, FONT } from "../theme";
import { useLayout } from "../LayoutContext";

/** A headline that rises in at `from` and, if `to` is given, lifts out and fades before `to`. */
export const Caption: React.FC<{
  text: React.ReactNode;
  from?: number;
  to?: number;
  size?: number;
  color?: string;
  weight?: number;
  style?: React.CSSProperties;
}> = ({ text, from = 0, to, size, color = C.ink, weight = 800, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { isPortrait, fontScale } = useLayout();
  const enter = spring({ frame: frame - from, fps, config: { damping: 200 }, durationInFrames: 16 });
  const exit = to === undefined ? 0 : interpolate(frame, [to - 10, to], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.in(Easing.cubic) });
  if (frame < from || (to !== undefined && frame >= to)) return null;
  const px = (size ?? (isPortrait ? 76 : 80)) * fontScale;
  return (
    <div
      style={{
        fontFamily: FONT,
        fontSize: px,
        lineHeight: 1.12,
        fontWeight: weight,
        letterSpacing: "-0.02em",
        color,
        textAlign: "center",
        textWrap: "balance",
        opacity: enter * (1 - exit),
        transform: `translateY(${(1 - enter) * 36 - exit * 24}px)`,
        ...style,
      }}
    >
      {text}
    </div>
  );
};
