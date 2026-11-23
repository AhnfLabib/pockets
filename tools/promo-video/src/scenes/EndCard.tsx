import React from "react";
import { AbsoluteFill, Img, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { C, FONT } from "../theme";
import { useLayout } from "../LayoutContext";

/** Scene 8: icon, full name and where to get it. Holds to the last frame (no fade to black). */
export const EndCard: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { isPortrait } = useLayout();
  const a = spring({ frame: frame - 2, fps, config: { damping: 13, stiffness: 130 } });
  const b = spring({ frame: frame - 10, fps, config: { damping: 200 }, durationInFrames: 18 });
  const c = spring({ frame: frame - 20, fps, config: { damping: 14, stiffness: 140 } });
  const icon = isPortrait ? 300 : 240;
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", fontFamily: FONT, padding: "0 70px" }}>
      <Img src={staticFile("icon-512.png")} style={{ width: icon, height: icon, transform: `scale(${a})`, filter: "drop-shadow(0 22px 40px rgba(28,34,48,.28))", marginBottom: isPortrait ? 70 : 50 }} />
      <div style={{ opacity: b, transform: `translateY(${(1 - b) * 30}px)`, textAlign: "center", color: C.ink, letterSpacing: "-0.02em", lineHeight: 1.08 }}>
        {isPortrait ? (
          <>
            <div style={{ fontSize: 112, fontWeight: 800 }}>Pockets</div>
            <div style={{ fontSize: 66, fontWeight: 700, color: C.accent, marginTop: 14 }}>the tab-stealing raccoon</div>
          </>
        ) : (
          <div style={{ fontSize: 84, fontWeight: 800 }}>
            Pockets: <span style={{ color: C.accent }}>the tab-stealing raccoon</span>
          </div>
        )}
      </div>
      <div
        style={{
          marginTop: isPortrait ? 90 : 64,
          background: C.ink,
          color: "#fff",
          borderRadius: 999,
          padding: isPortrait ? "30px 56px" : "26px 52px",
          fontSize: isPortrait ? 50 : 46,
          fontWeight: 700,
          letterSpacing: "-0.01em",
          transform: `scale(${c})`,
          boxShadow: "0 18px 40px rgba(28,34,48,.25)",
        }}
      >
        Free on the Chrome Web Store
      </div>
    </AbsoluteFill>
  );
};
