import React from "react";
import { CalculateMetadataFunction, Composition, staticFile } from "remotion";
import { Promo, DURATION } from "./Promo";
import type { FootageManifest, PopupManifest, PromoProps } from "./types";
import { Intro, type IntroProps } from "./intro/Intro";
import { DURATION as INTRO_DURATION } from "./intro/timeline";
import { Heist, type HeistProps } from "./heist/Heist";
import { DURATION as HEIST_DURATION } from "./heist/timeline";

const load = async <J,>(p: string): Promise<J | null> => {
  try {
    const r = await fetch(staticFile(p));
    return r.ok ? ((await r.json()) as J) : null;
  } catch {
    return null;
  }
};

// The captured footage's event marks (when the card shows, the take, the Undo click) drive the demo's cuts.
const withManifests: CalculateMetadataFunction<PromoProps> = async ({ props }) => ({
  props: {
    ...props,
    footage: await load<FootageManifest>(`footage/${props.variant}/manifest.json`),
    popup: await load<PopupManifest>("popup/manifest.json"),
  },
});

// The LinkedIn intro reads the crowded-tab footage (public/footage/intro) and the popup frames.
const introManifests: CalculateMetadataFunction<IntroProps> = async ({ props }) => ({
  props: {
    ...props,
    footage: await load<FootageManifest>("footage/intro/manifest.json"),
    popup: await load<PopupManifest>("popup/manifest.json"),
  },
});

// The heist cut reads its own dark-mode captures (footage, Pockets' head track) and the dark popup frames.
const heistManifests: CalculateMetadataFunction<HeistProps> = async ({ props }) => ({
  props: {
    ...props,
    footage: await load<FootageManifest>("footage/heist/manifest.json"),
    track: await load<HeistProps["track"]>("footage/heist/track.json"),
    popup: await load<PopupManifest>("heist-popup/manifest.json"),
  },
});

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="Promo-Landscape"
      component={Promo}
      durationInFrames={DURATION}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={{ variant: "landscape", footage: null, popup: null } as PromoProps}
      calculateMetadata={withManifests}
    />
    <Composition
      id="Promo-Portrait"
      component={Promo}
      durationInFrames={DURATION}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={{ variant: "portrait", footage: null, popup: null } as PromoProps}
      calculateMetadata={withManifests}
    />
    <Composition
      id="Intro-Portrait"
      component={Intro}
      durationInFrames={INTRO_DURATION}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={{ footage: null, popup: null, music: "" } as IntroProps}
      calculateMetadata={introManifests}
    />
    <Composition
      id="Heist-Portrait"
      component={Heist}
      durationInFrames={HEIST_DURATION}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={{ footage: null, track: null, popup: null } as HeistProps}
      calculateMetadata={heistManifests}
    />
    {/* The same timeline laid out natively for a square frame (stills only). */}
    <Composition
      id="Heist-Square"
      component={Heist}
      durationInFrames={HEIST_DURATION}
      fps={30}
      width={1080}
      height={1080}
      defaultProps={{ footage: null, track: null, popup: null } as HeistProps}
      calculateMetadata={heistManifests}
    />
  </>
);
