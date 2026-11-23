import React from "react";

/** Line icons (Lucide geometry, ISC licence) drawn inline so the render needs no icon package. */
const paths: Record<string, React.ReactNode> = {
  pin: (
    <>
      <path d="M12 17v5" />
      <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z" />
    </>
  ),
  keyboard: (
    <>
      <rect width="20" height="16" x="2" y="4" rx="2" />
      <path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M8 12h.01M12 12h.01M16 12h.01M7 16h10" />
    </>
  ),
  window: (
    <>
      <rect width="20" height="15" x="2" y="6" rx="2" />
      <path d="M2 10h20" />
      <path d="M4 6V4.5a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1V6" />
    </>
  ),
  lock: (
    <>
      <rect width="18" height="11" x="3" y="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </>
  ),
  check: <path d="M20 6 9 17l-5-5" />,
};

export const Icon: React.FC<{ name: keyof typeof paths; size: number; color: string; stroke?: number }> = ({ name, size, color, stroke = 2 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" style={{ display: "block", flex: "none" }}>
    {paths[name]}
  </svg>
);
