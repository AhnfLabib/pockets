import React from "react";
import { AbsoluteFill, Easing, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { C, FONT } from "../theme";
import { useLayout } from "../LayoutContext";
import { Caption } from "../components/Caption";
import { Pointer, Ripple } from "../components/Pointer";
import type { FootageManifest } from "../types";

/** Video frame of the demo at which the warning card appears; the climb before it plays slightly fast to fit. */
export const CARD_AT = 186;
/** First footage frame used: Pockets is just poking his head in. */
const START = 8;

const mark = (m: FootageManifest, name: string): number => {
  const hit = m.marks.find((x) => x.event === name);
  if (!hit) throw new Error(`footage manifest has no "${name}" mark`);
  return hit.frame;
};

/**
 * Scenes 3 to 5 as one continuous shot of the real character page: the climb, the five-second warning (real
 * speed, never sped up) and the take with Undo. Captions change on the footage's own event marks.
 */
export const Demo: React.FC<{ footage: FootageManifest | null; variant: "landscape" | "portrait" }> = ({ footage, variant }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { isPortrait, width } = useLayout();
  if (!footage) {
    return <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", fontFamily: FONT, fontSize: 48, color: C.accent }}>Footage missing: run npm run capture</AbsoluteFill>;
  }
  const cardF = mark(footage, "card-shown");
  const takeF = mark(footage, "take");
  const undoF = mark(footage, "undo-click");
  const take = CARD_AT + (takeF - cardF);
  const undo = CARD_AT + (undoF - cardF);
  const src = frame < CARD_AT ? START + (frame * (cardF - START)) / CARD_AT : cardF + (frame - CARD_AT);
  const n = Math.max(0, Math.min(footage.frames - 1, Math.round(src)));

  const cssW = footage.size.width / footage.dsf;
  const dispW = isPortrait ? width - 100 : 1290;
  const scale = dispW / cssW;
  const dispH = (footage.size.height / footage.dsf) * scale;
  const capTop = isPortrait ? 120 : 62;
  const capH = isPortrait ? 300 : 150;
  const shotTop = isPortrait ? 470 : 238;

  const enter = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 26 });
  const tiltX = interpolate(frame, [0, 26, 460], [14, 7, 3], { extrapolateRight: "clamp", easing: Easing.out(Easing.quad) });
  const tiltY = isPortrait ? 0 : interpolate(frame, [0, 460], [-5, 0], { extrapolateRight: "clamp" });

  // Pointer to Undo on the notice.
  const ux = (footage.undoRect.x + footage.undoRect.width / 2) * scale;
  const uy = (footage.undoRect.y + footage.undoRect.height / 2) * scale;
  const travel = interpolate(frame, [undo - 34, undo - 4], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.cubic) });
  const away = interpolate(frame, [undo + 10, undo + 40], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.in(Easing.cubic) });
  const press = interpolate(frame, [undo - 4, undo, undo + 6], [0, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const px = ux + (1 - travel) * 220 * (isPortrait ? 0.6 : 1) + away * 120;
  const py = uy + (1 - travel) * 160 + away * 90;
  const pOpacity = interpolate(frame, [undo - 34, undo - 26, undo + 28, undo + 40], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const capSize = isPortrait ? 74 : 72;

  return (
    <AbsoluteFill style={{ fontFamily: FONT }}>
      <div style={{ position: "absolute", left: 0, right: 0, top: capTop, height: capH, display: "flex", alignItems: "center", justifyContent: "center", padding: isPortrait ? "0 60px" : "0 90px" }}>
        {[
          { text: "Leave a tab alone for a day…", from: 0, to: CARD_AT + 2 },
          { text: "…and he gives you five seconds' warning.", from: CARD_AT + 2, to: take + 4 },
          { text: "He takes it. Undo brings it back.", from: take + 4, to: undefined },
        ].map((c) => (
          <div key={c.text} style={{ position: "absolute", left: isPortrait ? 60 : 90, right: isPortrait ? 60 : 90, top: 0, bottom: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Caption text={c.text} from={c.from} to={c.to} size={capSize} />
          </div>
        ))}
      </div>
      <div style={{ position: "absolute", top: shotTop, left: 0, right: 0, display: "flex", justifyContent: "center", perspective: 2400 }}>
        <div
          style={{
            position: "relative",
            width: dispW,
            height: dispH,
            opacity: enter,
            transform: `translateY(${(1 - enter) * 70}px) rotateX(${tiltX}deg) rotateY(${tiltY}deg)`,
            transformOrigin: "50% 100%",
            borderRadius: 10 * scale,
            boxShadow: "0 40px 90px rgba(28,34,48,.22), 0 10px 26px rgba(28,34,48,.10)",
          }}
        >
          <Img src={staticFile(`footage/${variant}/f${String(n).padStart(4, "0")}.png`)} style={{ width: dispW, height: dispH, display: "block" }} />
          <Ripple x={ux} y={uy} t={(frame - undo) / 16} />
          {pOpacity > 0 ? <Pointer x={px} y={py} size={isPortrait ? 46 : 42} press={press} opacity={pOpacity} /> : null}
        </div>
      </div>
    </AbsoluteFill>
  );
};
