import React from "react";
import { CalculateMetadataFunction, Composition, staticFile } from "remotion";
import { Promo, DURATION } from "./Promo";
import type { FootageManifest, PopupManifest, PromoProps } from "./types";

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
  </>
);
