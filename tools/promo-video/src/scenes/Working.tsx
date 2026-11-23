import React from "react";
import { AbsoluteFill, Easing, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { C, FONT } from "../theme";
import { useLayout } from "../LayoutContext";
import { Caption } from "../components/Caption";
import { Pointer, Ripple } from "../components/Pointer";
import type { PopupManifest } from "../types";

const CLICK = 38;

/** Scene 6: the real toolbar popup; the pointer flips the Working switch on. */
export const Working: React.FC<{ popup: PopupManifest | null }> = ({ popup }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { isPortrait } = useLayout();
  if (!popup) return null;
  const cssW = popup.size.width / popup.dsf;
  const dispW = isPortrait ? 760 : 560;
  const scale = dispW / cssW;
  const dispH = (popup.size.height / popup.dsf) * scale;
  const idx = frame < CLICK ? 0 : Math.min(popup.frames - 1, frame - CLICK + 1);
  const enter = spring({ frame: frame - 4, fps, config: { damping: 200 }, durationInFrames: 22 });

  const sx = (popup.switchRect.x + 22) * scale;
  const sy = (popup.switchRect.y + popup.switchRect.height / 2) * scale;
  const travel = interpolate(frame, [10, CLICK - 3], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.cubic) });
  const away = interpolate(frame, [CLICK + 12, CLICK + 40], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.in(Easing.cubic) });
  const press = interpolate(frame, [CLICK - 4, CLICK, CLICK + 6], [0, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const px = sx + (1 - travel) * 240 + away * 160;
  const py = sy + (1 - travel) * 300 + away * 120;
  const pOpacity = interpolate(frame, [10, 18, CLICK + 26, CLICK + 40], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  const text = (
    <div style={{ display: "flex", flexDirection: "column", gap: isPortrait ? 18 : 22, width: isPortrait ? "100%" : 780 }}>
      <Caption text="Working?" from={0} size={isPortrait ? 100 : 96} color={C.accent} style={{ textAlign: isPortrait ? "center" : "left" }} />
      <Caption text="Distracting sites get taken too." from={8} size={isPortrait ? 72 : 72} style={{ textAlign: isPortrait ? "center" : "left" }} />
    </div>
  );
  const card = (
    <div
      style={{
        position: "relative",
        width: dispW,
        height: dispH,
        borderRadius: 22,
        overflow: "visible",
        opacity: enter,
        transform: `translateY(${(1 - enter) * 60}px) perspective(2000px) rotateY(${isPortrait ? 0 : -6 * (1 - enter * 0.5)}deg)`,
      }}
    >
      <div style={{ position: "absolute", inset: 0, borderRadius: 22, overflow: "hidden", border: `1px solid ${C.line}`, boxShadow: "0 30px 70px rgba(28,34,48,.22), 0 8px 20px rgba(28,34,48,.10)", background: "#fff" }}>
        <Img src={staticFile(`popup/p${String(idx).padStart(3, "0")}.png`)} style={{ width: dispW, height: dispH, display: "block" }} />
      </div>
      <Ripple x={sx} y={sy} t={(frame - CLICK) / 16} color="#5b4bd6" />
      {pOpacity > 0 ? <Pointer x={px} y={py} size={isPortrait ? 50 : 44} press={press} opacity={pOpacity} /> : null}
    </div>
  );
  return (
    <AbsoluteFill
      style={{
        fontFamily: FONT,
        flexDirection: isPortrait ? "column" : "row",
        alignItems: "center",
        justifyContent: "center",
        gap: isPortrait ? 80 : 110,
        padding: isPortrait ? "0 60px" : "0 110px",
      }}
    >
      {text}
      {card}
    </AbsoluteFill>
  );
};
