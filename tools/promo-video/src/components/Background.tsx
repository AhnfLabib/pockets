import React from "react";
import { AbsoluteFill } from "remotion";
import { C } from "../theme";

/** The light ground behind every scene, with a soft white glow so the frame never looks flat. */
export const Background: React.FC = () => (
  <AbsoluteFill
    style={{
      background: `radial-gradient(ellipse 75% 60% at 50% 42%, #ffffff 0%, ${C.bg} 70%), ${C.bg}`,
    }}
  />
);
