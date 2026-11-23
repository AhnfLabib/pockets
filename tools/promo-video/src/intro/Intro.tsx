import React from "react";
import { AbsoluteFill, Audio, interpolate, staticFile, useVideoConfig } from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { LayoutProvider } from "../LayoutContext";
import { Background } from "../components/Background";
import { IntroDemo } from "./IntroDemo";
import { IntroEnd, Rules, Trust, Working } from "./Beats";
import { DURATION, FADE, SCENES, type SceneId } from "./timeline";
import type { FootageManifest, PopupManifest } from "../types";

export interface IntroProps extends Record<string, unknown> {
  footage: FootageManifest | null;
  popup: PopupManifest | null;
  /** Music file under public/ (render-intro.sh copies the track there); empty for a silent render. */
  music: string;
}

/** The LinkedIn intro, portrait 1080x1920: the crowded-tabs hook and demo in one shot, three quick beats, end card. */
export const Intro: React.FC<IntroProps> = ({ footage, popup, music }) => {
  const { width, height, fps } = useVideoConfig();
  const scene = (id: SceneId): React.ReactNode => {
    switch (id) {
      case "demo": return <IntroDemo footage={footage} />;
      case "rules": return <Rules />;
      case "working": return <Working popup={popup} />;
      case "trust": return <Trust />;
      case "end": return <IntroEnd />;
    }
  };
  return (
    <LayoutProvider width={width} height={height}>
      <AbsoluteFill>
        <Background />
        <TransitionSeries>
          {SCENES.flatMap((s, i) => [
            ...(i > 0 ? [<TransitionSeries.Transition key={`t-${s.id}`} presentation={fade()} timing={linearTiming({ durationInFrames: FADE })} />] : []),
            <TransitionSeries.Sequence key={s.id} durationInFrames={s.frames}>{scene(s.id)}</TransitionSeries.Sequence>,
          ])}
        </TransitionSeries>
        {music ? (
          <Audio
            src={staticFile(music)}
            trimBefore={24}
            volume={(f) => 0.3 * interpolate(f, [0, 6, DURATION - 1.5 * fps, DURATION - 1], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}
          />
        ) : null}
      </AbsoluteFill>
    </LayoutProvider>
  );
};
