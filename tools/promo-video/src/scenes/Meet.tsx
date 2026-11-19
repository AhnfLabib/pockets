import React from "react";
import { AbsoluteFill, Img, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { C, FONT } from "../theme";
import { useLayout } from "../LayoutContext";
import { Caption } from "../components/Caption";

/** Scene 2: the raccoon face icon pops in, then his name. */
export const Meet: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { isPortrait } = useLayout();
  const pop = spring({ frame: frame - 2, fps, config: { damping: 11, stiffness: 140, mass: 0.8 } });
  const size = isPortrait ? 340 : 300;
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", fontFamily: FONT }}>
      <Img
        src={staticFile("icon-512.png")}
        style={{
          width: size,
          height: size,
          transform: `scale(${pop}) rotate(${(1 - pop) * -8}deg)`,
          filter: "drop-shadow(0 22px 40px rgba(28,34,48,.28))",
          marginBottom: isPortrait ? 70 : 54,
        }}
      />
      <Caption text="Meet Pockets." from={12} size={isPortrait ? 104 : 96} />
      <Caption text="the tab-stealing raccoon" from={22} size={isPortrait ? 58 : 52} weight={600} color={C.accent} style={{ marginTop: 14, letterSpacing: "-0.01em" }} />
    </AbsoluteFill>
  );
};
