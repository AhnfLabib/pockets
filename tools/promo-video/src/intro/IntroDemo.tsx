import React from "react";
import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { C, FONT } from "../theme";
import { Pointer, Ripple } from "../components/Pointer";
import { Headline } from "./Headline";
import { DEMO, LINES, TAKE, UNDO } from "./timeline";
import type { FootageManifest } from "../types";

const mark = (m: FootageManifest, name: string): number => {
  const hit = m.marks.find((x) => x.event === name);
  if (!hit) throw new Error(`footage manifest has no "${name}" mark`);
  return hit.frame;
};

/** Comp frame (scene-relative) to footage frame: the climb sped up (1.5x, then about 2x), everything after at 1x. */
export function footFrame(m: FootageManifest, f: number): number {
  const cardF = mark(m, "card-shown");
  const quoteF = DEMO.footStart + DEMO.quoteHold * 1.5;
  const keys: [number, number][] = [
    [0, DEMO.footStart],
    [DEMO.quoteHold, quoteF],
    [DEMO.card, cardF],
    [DEMO.card + 1000, cardF + 1000],
  ];
  const n = interpolate(f, keys.map((k) => k[0]), keys.map((k) => k[1]), { extrapolateRight: "clamp" });
  return Math.max(0, Math.min(m.frames - 1, Math.round(n)));
}

/**
 * The intro's demo: one continuous shot of the real character page on a browser crammed with 32 tabs. Pockets climbs
 * in (sped up), warns with the real five-second card (real speed), takes YouTube and bolts; a pointer presses Undo.
 */
export const IntroDemo: React.FC<{ footage: FootageManifest | null }> = ({ footage }) => {
  const frame = useCurrentFrame();
  if (!footage) {
    return <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", fontFamily: FONT, fontSize: 44, color: C.accent }}>Footage missing: see README (intro)</AbsoluteFill>;
  }
  const n = footFrame(footage, frame);
  const cssW = footage.size.width / footage.dsf;
  const dispW = 960;
  const scale = dispW / cssW;
  const dispH = (footage.size.height / footage.dsf) * scale;
  const shotTop = 540;

  // Hook: open close on the crammed tab strip, then pull back to the whole browser as Pockets appears.
  const pull = interpolate(frame, [0, 26], [0, 1], { extrapolateRight: "clamp", easing: Easing.inOut(Easing.cubic) });
  // During the countdown, a slow push towards the card.
  const push = interpolate(frame, [DEMO.card, TAKE], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.quad) });
  // Push in on Pockets and the card for the countdown and the steal, then back out before the Undo notice.
  const push2 = interpolate(frame, [DEMO.card - 6, DEMO.card + 16], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.cubic) });
  const relax = interpolate(frame, [TAKE + 20, TAKE + 40], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.cubic) });
  const inOn = push2 * (1 - relax);
  const zoom = 1 + 0.42 * (1 - pull) + (0.24 + 0.04 * push) * inOn;
  const lift = -60 * (1 - pull);
  const originX = 50 + 8 * inOn;

  // Pointer to Undo on the notice.
  const ux = (footage.undoRect.x + footage.undoRect.width / 2) * scale;
  const uy = (footage.undoRect.y + footage.undoRect.height / 2) * scale;
  const travel = interpolate(frame, [UNDO - 30, UNDO - 4], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.cubic) });
  const away = interpolate(frame, [UNDO + 10, UNDO + 36], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.in(Easing.cubic) });
  const press = interpolate(frame, [UNDO - 4, UNDO, UNDO + 6], [0, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const px = ux + (1 - travel) * 150 + away * 90;
  const py = uy + (1 - travel) * 200 + away * 120;
  const pOpacity = interpolate(frame, [UNDO - 30, UNDO - 22, UNDO + 24, UNDO + 36], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  const lines = LINES.filter((l) => l.scene === "demo");
  return (
    <AbsoluteFill style={{ fontFamily: FONT }}>
      <div style={{ position: "absolute", top: shotTop, left: 0, right: 0, display: "flex", justifyContent: "center" }}>
        <div
          style={{
            position: "relative",
            width: dispW,
            height: dispH,
            transform: `translateY(${lift}px) scale(${zoom})`,
            transformOrigin: `${originX}% 0%`,
            borderRadius: 10 * scale,
            boxShadow: "0 40px 90px rgba(28,34,48,.20), 0 10px 26px rgba(28,34,48,.10)",
          }}
        >
          <Img src={staticFile(`footage/intro/f${String(n).padStart(4, "0")}.png`)} style={{ width: dispW, height: dispH, display: "block" }} />
          <Ripple x={ux} y={uy} t={(frame - UNDO) / 16} />
          {pOpacity > 0 ? <Pointer x={px} y={py} size={46} press={press} opacity={pOpacity} /> : null}
        </div>
      </div>
      {/* Captions sit on a band of the background colour, so the zoomed-in hook never runs under them. */}
      <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 470, background: `linear-gradient(${C.bg} 0%, ${C.bg} 88%, rgba(236,238,242,0) 100%)` }} />
      <div style={{ position: "absolute", left: 70, right: 70, top: 120, height: 330, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {lines.map((l) => (
          <div key={l.text} style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Headline text={l.text} sub={l.sub} from={l.from} to={l.to} instant={l.from === 0} subDelay={l.from === 0 ? 24 : 6} size={l.from === 0 ? 108 : 92} />
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};
