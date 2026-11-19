import React from "react";
import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { C, FONT } from "../theme";
import { useLayout } from "../LayoutContext";

const Keyboard: React.FC<{ s: number }> = ({ s }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={C.accent} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="5" width="20" height="14" rx="2.5" />
    <path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 12.5h.01M10 12.5h.01M14 12.5h.01M18 12.5h.01M7.5 16h9" strokeWidth={2.4} />
  </svg>
);
const Lock: React.FC<{ s: number }> = ({ s }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={C.accent} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="10.5" width="16" height="10.5" rx="2.5" />
    <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    <path d="M12 14.5v2.5" strokeWidth={2.4} />
  </svg>
);

/** Scene 7: the two promises that matter most to a cautious installer. */
export const Trust: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { isPortrait } = useLayout();
  const rows = [
    { icon: Keyboard, text: "Never takes tabs you've typed in." },
    { icon: Lock, text: "Nothing leaves your browser." },
  ];
  const kick = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 14 });
  const iconBox = isPortrait ? 132 : 128;
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", fontFamily: FONT, padding: isPortrait ? "0 64px" : "0 110px" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: isPortrait ? 70 : 56, alignItems: isPortrait ? "center" : "flex-start" }}>
        <div style={{ fontSize: isPortrait ? 40 : 36, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: C.muted, opacity: kick, transform: `translateY(${(1 - kick) * 20}px)`, alignSelf: "center" }}>
          Your tabs, your call
        </div>
        {rows.map((r, i) => {
          const p = spring({ frame: frame - 8 - i * 14, fps, config: { damping: 16, stiffness: 120 } });
          const Icon = r.icon;
          return (
            <div
              key={r.text}
              style={{
                display: "flex",
                flexDirection: isPortrait ? "column" : "row",
                alignItems: "center",
                gap: isPortrait ? 30 : 44,
                opacity: Math.min(1, p * 1.4),
                transform: `translateX(${isPortrait ? 0 : (1 - p) * -80}px) translateY(${isPortrait ? (1 - p) * 50 : 0}px)`,
              }}
            >
              <div style={{ width: iconBox, height: iconBox, borderRadius: iconBox / 2, background: "#fbe9e7", display: "grid", placeItems: "center", flex: "none", boxShadow: "0 10px 26px rgba(201,60,48,.18)" }}>
                <Icon s={iconBox * 0.56} />
              </div>
              <div style={{ fontSize: isPortrait ? 70 : 74, fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1.12, color: C.ink, textAlign: isPortrait ? "center" : "left", textWrap: "balance", maxWidth: isPortrait ? 900 : 1300 }}>
                {r.text}
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
