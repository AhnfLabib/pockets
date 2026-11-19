import React from "react";

/** A plain arrow pointer whose tip is at (x, y). `press` 0..1 squashes it slightly for a click. */
export const Pointer: React.FC<{ x: number; y: number; size?: number; press?: number; opacity?: number }> = ({ x, y, size = 44, press = 0, opacity = 1 }) => (
  <svg
    width={size}
    height={size * 1.4}
    viewBox="0 0 20 28"
    style={{
      position: "absolute",
      left: x,
      top: y,
      opacity,
      transform: `scale(${1 - press * 0.14})`,
      transformOrigin: "0 0",
      filter: "drop-shadow(0 3px 5px rgba(20,26,40,.35))",
      overflow: "visible",
    }}
  >
    <path d="M1 1 L1 22 L6.5 16.8 L10.4 25.6 L14 24 L10.2 15.4 L17.6 15.2 Z" fill="#1c2230" stroke="#ffffff" strokeWidth={1.6} strokeLinejoin="round" />
  </svg>
);

/** A click ripple centred on (x, y), drawn while `t` runs 0..1. */
export const Ripple: React.FC<{ x: number; y: number; t: number; color?: string; radius?: number }> = ({ x, y, t, color = "#c93c30", radius = 46 }) =>
  t <= 0 || t >= 1 ? null : (
    <div
      style={{
        position: "absolute",
        left: x - radius,
        top: y - radius,
        width: radius * 2,
        height: radius * 2,
        borderRadius: "50%",
        border: `4px solid ${color}`,
        opacity: (1 - t) * 0.8,
        transform: `scale(${0.3 + t * 0.9})`,
      }}
    />
  );
