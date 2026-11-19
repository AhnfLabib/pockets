import React from "react";
import { AbsoluteFill, useVideoConfig } from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { LayoutProvider } from "./LayoutContext";
import { Background } from "./components/Background";
import { Hook } from "./scenes/Hook";
import { Meet } from "./scenes/Meet";
import { Demo } from "./scenes/Demo";
import { Working } from "./scenes/Working";
import { Trust } from "./scenes/Trust";
import { EndCard } from "./scenes/EndCard";
import type { PromoProps } from "./types";

export const T = 12; // transition length in frames
// Scene lengths include the 12 frames each overlaps the next. 102+102+462+102+102+90 - 5*12 = 900 = 30 s.
// Hook 0-3 s, Meet 3-6 s, Demo 6-21 s (climb, warning, steal), Working 21-24 s, Trust 24-27 s, End 27-30 s.
export const SCENES = { hook: 102, meet: 102, demo: 462, working: 102, trust: 102, end: 90 };
export const DURATION = Object.values(SCENES).reduce((a, b) => a + b, 0) - 5 * T;

export const Promo: React.FC<PromoProps> = ({ variant, footage, popup }) => {
  const { width, height } = useVideoConfig();
  const t = () => <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: T })} />;
  return (
    <LayoutProvider width={width} height={height}>
      <AbsoluteFill>
        <Background />
        <TransitionSeries>
          <TransitionSeries.Sequence durationInFrames={SCENES.hook}><Hook /></TransitionSeries.Sequence>
          {t()}
          <TransitionSeries.Sequence durationInFrames={SCENES.meet}><Meet /></TransitionSeries.Sequence>
          {t()}
          <TransitionSeries.Sequence durationInFrames={SCENES.demo}><Demo footage={footage} variant={variant} /></TransitionSeries.Sequence>
          {t()}
          <TransitionSeries.Sequence durationInFrames={SCENES.working}><Working popup={popup} /></TransitionSeries.Sequence>
          {t()}
          <TransitionSeries.Sequence durationInFrames={SCENES.trust}><Trust /></TransitionSeries.Sequence>
          {t()}
          <TransitionSeries.Sequence durationInFrames={SCENES.end}><EndCard /></TransitionSeries.Sequence>
        </TransitionSeries>
      </AbsoluteFill>
    </LayoutProvider>
  );
};
