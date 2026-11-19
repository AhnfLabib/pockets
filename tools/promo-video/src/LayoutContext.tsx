import React, { createContext, useContext } from "react";

export interface LayoutInfo {
  width: number;
  height: number;
  isPortrait: boolean;
  /** Padding from the frame edges. */
  padding: number;
  /** Multiplier for text sizes. Portrait is watched on a phone held close, so text stays large. */
  fontScale: number;
}

const LayoutContext = createContext<LayoutInfo>({ width: 1920, height: 1080, isPortrait: false, padding: 90, fontScale: 1 });

export const useLayout = () => useContext(LayoutContext);

export const LayoutProvider: React.FC<{ width: number; height: number; children: React.ReactNode }> = ({ width, height, children }) => {
  const isPortrait = height > width;
  return (
    <LayoutContext.Provider value={{ width, height, isPortrait, padding: isPortrait ? 64 : 90, fontScale: isPortrait ? 1.0 : 1 }}>
      {children}
    </LayoutContext.Provider>
  );
};
