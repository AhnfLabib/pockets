// "Night heist" LinkedIn intro, cut to the beats of "Fast Percussion" (see timeline.ts and beats.json).
// Picture only: the music is trimmed, normalised and muxed by render-heist.sh, sample-accurately, after the render.
import React from "react";
import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import type { FootageManifest, PopupManifest } from "../types";
import { B, CAPTIONS, DURATION, SCENES, type SceneName } from "./timeline";
import { HEAVY, HeistLayoutProvider, N, Row, Track, fit, useLayout } from "./kit";
import { Climb, EndCard, LastTab, Local, Pinned, Spotlit, Steal, Typing, Undo, Warning, Whip, Working, type SceneProps } from "./scenes";

export interface HeistProps extends Record<string, unknown> {
  footage: FootageManifest | null;
  track: Track | null;
  popup: PopupManifest | null;
}

const VIEWS: Record<Exclude<SceneName, "end">, React.FC<SceneProps>> = {
  spotlight: Spotlit, whip: Whip, climb: Climb, warning: Warning, steal: Steal, undo: Undo,
  pinned: Pinned, typing: Typing, last: LastTab, working: Working, local: Local,
};

/** The caption block: rows appear one per beat, centred, huge; *word* in red. */
const Captions: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const L = useLayout();
  const line = CAPTIONS.find((l) => frame >= B(l.beat) && frame < B(l.until));
  if (!line) return null;
  const size = fit(line.rows, L.captionSize, L.captionW);
  const h = line.rows.length * size;
  return (
    <div style={{ position: "absolute", left: L.captionX - L.captionW / 2, width: L.captionW, top: L.captionY - h / 2, display: "flex", flexDirection: "column", alignItems: "center" }}>
      {line.rows.map((r, i) => (
        <Row key={i} text={r} size={size} f={frame - B(line.beat + i)} fps={fps} />
      ))}
    </div>
  );
};

export const Heist: React.FC<HeistProps> = ({ footage, track, popup }) => {
  if (!footage) {
    return <AbsoluteFill style={{ background: N.bg, color: N.red, fontFamily: HEAVY, fontSize: 60, alignItems: "center", justifyContent: "center" }}>Footage missing: see README (heist)</AbsoluteFill>;
  }
  return (
    <HeistLayoutProvider>
    <AbsoluteFill style={{ background: N.bgDeep }}>
      {(Object.keys(VIEWS) as (keyof typeof VIEWS)[]).map((name) => {
        const [a, b] = SCENES[name];
        const View = VIEWS[name];
        return (
          <Sequence key={name} from={B(a)} durationInFrames={B(b) - B(a)} name={name}>
            <View m={footage} track={track} popup={popup} />
          </Sequence>
        );
      })}
      <Sequence from={B(SCENES.end[0])} durationInFrames={DURATION - B(SCENES.end[0])} name="end">
        <EndCard />
      </Sequence>
      <Captions />
    </AbsoluteFill>
    </HeistLayoutProvider>
  );
};
