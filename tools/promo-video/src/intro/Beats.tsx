import React from "react";
import { AbsoluteFill, Easing, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { C, FONT } from "../theme";
import { Pointer, Ripple } from "../components/Pointer";
import { Headline } from "./Headline";
import { Icon } from "./Icons";
import { LINES, type SceneId } from "./timeline";
import type { PopupManifest } from "../types";

const line = (scene: SceneId) => {
  const l = LINES.find((x) => x.scene === scene);
  if (!l) throw new Error(`no line for ${scene}`);
  return l;
};
const useRise = (delay: number, frames = 16) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - delay, fps, config: { damping: 200 }, durationInFrames: frames });
};

/** Beat: what Pockets never takes, as three rows that land one after another. */
export const Rules: React.FC = () => {
  const l = line("rules");
  const rows: { icon: "pin" | "keyboard" | "window"; text: string }[] = [
    { icon: "pin", text: "Pinned tabs" },
    { icon: "keyboard", text: "Tabs you’ve typed in" },
    { icon: "window", text: "Your last tab" },
  ];
  const r = [useRise(6), useRise(12), useRise(18)];
  return (
    <AbsoluteFill style={{ fontFamily: FONT, alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 70, padding: "0 80px" }}>
      <Headline text={l.text} size={104} />
      <div style={{ display: "flex", flexDirection: "column", gap: 30, width: "100%" }}>
        {rows.map((row, i) => (
          <div
            key={row.text}
            style={{
              display: "flex", alignItems: "center", gap: 34, background: "#fff", borderRadius: 30, padding: "34px 40px",
              border: `1px solid ${C.line}`, boxShadow: "0 18px 40px rgba(28,34,48,.10)",
              opacity: r[i], transform: `translateY(${(1 - r[i]) * 40}px)`,
            }}
          >
            <div style={{ width: 104, height: 104, borderRadius: 26, background: "#fbeceb", display: "grid", placeItems: "center", flex: "none" }}>
              <Icon name={row.icon} size={58} color={C.accent} />
            </div>
            <div style={{ fontSize: 60, fontWeight: 700, color: C.ink, letterSpacing: "-0.02em", flex: 1 }}>{row.text}</div>
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};

const CLICK = 20;
/** Beat: the real toolbar popup; the pointer flips the Working switch on early, so it reads as on for over a second. */
export const Working: React.FC<{ popup: PopupManifest | null }> = ({ popup }) => {
  const frame = useCurrentFrame();
  const l = line("working");
  const enter = useRise(0, 18);
  if (!popup) return null;
  const cssW = popup.size.width / popup.dsf;
  const dispW = 680;
  const scale = dispW / cssW;
  const dispH = (popup.size.height / popup.dsf) * scale;
  const idx = frame < CLICK ? 0 : Math.min(popup.frames - 1, frame - CLICK + 1);
  const sx = (popup.switchRect.x + 22) * scale;
  const sy = (popup.switchRect.y + popup.switchRect.height / 2) * scale;
  const travel = interpolate(frame, [2, CLICK - 3], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.cubic) });
  const away = interpolate(frame, [CLICK + 10, CLICK + 34], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.in(Easing.cubic) });
  const press = interpolate(frame, [CLICK - 4, CLICK, CLICK + 6], [0, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const px = sx + (1 - travel) * 220 + away * 160;
  const py = sy + (1 - travel) * 260 + away * 140;
  const pOpacity = interpolate(frame, [2, 8, CLICK + 22, CLICK + 34], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ fontFamily: FONT, alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 80, padding: "0 70px" }}>
      <Headline text={l.text} sub={l.sub} size={104} subSize={62} color={C.accent} subColor={C.ink} />
      <div style={{ position: "relative", width: dispW, height: dispH, opacity: enter, transform: `translateY(${(1 - enter) * 60}px)` }}>
        <div style={{ position: "absolute", inset: 0, borderRadius: 24, overflow: "hidden", border: `1px solid ${C.line}`, boxShadow: "0 30px 70px rgba(28,34,48,.20), 0 8px 20px rgba(28,34,48,.08)", background: "#fff" }}>
          <Img src={staticFile(`popup/p${String(idx).padStart(3, "0")}.png`)} style={{ width: dispW, height: dispH, display: "block" }} />
        </div>
        <Ripple x={sx} y={sy} t={(frame - CLICK) / 16} color="#5b4bd6" />
        {pOpacity > 0 ? <Pointer x={px} y={py} size={50} press={press} opacity={pOpacity} /> : null}
      </div>
    </AbsoluteFill>
  );
};

/** Beat: privacy. A lock badge, the claim, and what that means. */
export const Trust: React.FC = () => {
  const l = line("trust");
  const a = useRise(0, 18);
  return (
    <AbsoluteFill style={{ fontFamily: FONT, alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 80, padding: "0 80px" }}>
      <div style={{ width: 250, height: 250, borderRadius: 70, background: "#fff", border: `1px solid ${C.line}`, display: "grid", placeItems: "center", boxShadow: "0 26px 60px rgba(28,34,48,.14)", opacity: a, transform: `scale(${0.85 + 0.15 * a})` }}>
        <Icon name="lock" size={130} color={C.accent} stroke={1.8} />
      </div>
      <Headline text={l.text} sub={l.sub} size={100} subSize={56} subColor={C.muted} subDelay={8} />
    </AbsoluteFill>
  );
};

/** End card: icon, full name and where to get it. Holds to the last frame. */
export const IntroEnd: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const a = spring({ frame: frame - 2, fps, config: { damping: 15, stiffness: 120 } });
  const b = useRise(10, 18);
  const c = useRise(22, 18);
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", fontFamily: FONT, padding: "0 70px" }}>
      <Img src={staticFile("icon-512.png")} style={{ width: 320, height: 320, transform: `scale(${a})`, filter: "drop-shadow(0 22px 40px rgba(28,34,48,.26))", marginBottom: 76 }} />
      <div style={{ opacity: b, transform: `translateY(${(1 - b) * 30}px)`, textAlign: "center", color: C.ink, letterSpacing: "-0.025em", lineHeight: 1.06 }}>
        <div style={{ fontSize: 128, fontWeight: 800 }}>Pockets:</div>
        <div style={{ fontSize: 72, fontWeight: 700, color: C.accent, marginTop: 16 }}>the tab-stealing raccoon</div>
      </div>
      <div style={{ marginTop: 96, opacity: c, transform: `translateY(${(1 - c) * 24}px)`, background: C.ink, color: "#fff", borderRadius: 999, padding: "30px 56px", fontSize: 46, fontWeight: 700, letterSpacing: "-0.01em", boxShadow: "0 18px 40px rgba(28,34,48,.22)" }}>
        Available on the Chrome Web Store
      </div>
    </AbsoluteFill>
  );
};
