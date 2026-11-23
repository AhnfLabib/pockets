import React from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import { C, FONT } from "../theme";
import { useLayout } from "../LayoutContext";
import { Caption } from "../components/Caption";

const TITLES = ["Q3 report", "Inbox", "YouTube", "Sheet", "Flights", "Recipes", "Reddit", "Docs", "Maps", "News", "PR #212", "Wiki", "Calendar", "Hotels", "Slides", "Shop", "Notes", "Tickets", "Forum", "Weather"];
const COLORS = ["#3d7be0", "#d9962f", "#d93a2f", "#2f9d62", "#7a5bd0", "#e0703d", "#ff5a1f", "#4a90b8", "#36a372", "#8a8f99", "#24292f", "#6d6d6d", "#3d7be0", "#b0417a", "#e0b43d"];

/** Scene 1: a tab strip that keeps filling until forty tabs are squeezed into it. */
export const Hook: React.FC = () => {
  const frame = useCurrentFrame();
  const { isPortrait, width } = useLayout();
  const winW = isPortrait ? width - 70 : 1640;
  const k = isPortrait ? 1.9 : 1.5; // CSS-px scale of the mock browser chrome
  const stripPad = 8 * k;
  const avail = winW - stripPad - 70 * k;
  // Continuous tab count: starts at 5, accelerates to 40.
  const count = interpolate(frame, [4, 62], [5, 40], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.in(Easing.quad) });
  const whole = Math.floor(count);
  const frac = count - whole;
  const unit = avail / count;
  const tabs: { w: number; i: number }[] = [];
  for (let i = 0; i < whole; i++) tabs.push({ w: unit, i });
  if (frac > 0.001) tabs.push({ w: unit * frac, i: whole });
  const tabH = 34 * k;

  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", gap: isPortrait ? 90 : 80, fontFamily: FONT }}>
      <Caption text="Forty tabs open?" from={4} size={isPortrait ? 96 : 90} />
      <div
        style={{
          width: winW,
          borderRadius: 12 * k,
          overflow: "hidden",
          background: "#ffffff",
          border: `1px solid ${C.line}`,
          boxShadow: "0 30px 70px rgba(28,34,48,.18), 0 6px 18px rgba(28,34,48,.08)",
        }}
      >
        <div style={{ background: C.strip, height: 42 * k, display: "flex", alignItems: "flex-end", paddingLeft: stripPad, position: "relative" }}>
          {tabs.map(({ w, i }) => {
            const showText = w > 96 * k * 0.9;
            return (
              <div
                key={i}
                style={{
                  width: w,
                  flex: "none",
                  height: tabH,
                  background: i === 0 ? C.surface : C.tabIdle,
                  borderRadius: `${8 * k}px ${8 * k}px 0 0`,
                  borderRight: `${2 * k * Math.min(1, w / 20)}px solid ${C.strip}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: showText ? "flex-start" : "center",
                  gap: 6 * k,
                  padding: showText ? `0 ${10 * k}px` : 0,
                  overflow: "hidden",
                  boxSizing: "border-box",
                }}
              >
                {w > 10 ? <i style={{ width: Math.min(16 * k, w - 6), height: Math.min(16 * k, w - 6), borderRadius: 3 * k, background: COLORS[i % COLORS.length], flex: "none", display: "block" }} /> : null}
                {showText ? (
                  <span style={{ fontSize: 12 * k, color: i === 0 ? C.ink : C.muted, fontWeight: i === 0 ? 600 : 400, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {TITLES[i % TITLES.length]}
                  </span>
                ) : null}
              </div>
            );
          })}
          <span style={{ position: "absolute", right: 24 * k, top: 11 * k, fontSize: 20 * k, color: C.muted }}>+</span>
        </div>
        <div style={{ background: C.surface, borderBottom: `1px solid ${C.line}`, padding: `${8 * k}px ${12 * k}px` }}>
          <div style={{ background: C.ghost, borderRadius: 999, height: 24 * k, fontSize: 12 * k, color: C.muted, display: "flex", alignItems: "center", paddingLeft: 12 * k }}>
            docs.example.com/q3-report-draft
          </div>
        </div>
        <div style={{ padding: `${26 * k}px ${70 * k}px ${30 * k}px`, display: "flex", flexDirection: "column", gap: 11 * k }}>
          {(isPortrait ? [92, 100, 84, 96, 60, 0, 98, 88, 72] : [92, 100, 84, 96, 60]).map((w, i) => (
            <div key={i} style={{ height: 10 * k, width: `${w}%`, borderRadius: 5 * k, background: C.ghost }} />
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
};
