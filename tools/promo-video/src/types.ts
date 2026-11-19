/** Written by capture/capture.mjs next to the frames in public/footage/<variant>/. */
export interface FootageManifest {
  seed: number;
  variant: "landscape" | "portrait";
  fps: number;
  /** Device pixels per CSS pixel of the captured page. */
  dsf: number;
  frames: number;
  /** Size of each PNG in device pixels. */
  size: { width: number; height: number };
  /** The Undo button on the notice, in CSS px from the mock browser's top left. */
  undoRect: { x: number; y: number; width: number; height: number };
  marks: { event: string; frame: number }[];
}

/** Written by capture/popup.mjs next to the frames in public/popup/. */
export interface PopupManifest {
  frames: number;
  dsf: number;
  /** The working switch's label (track plus text), in CSS px from the popup's top left. */
  switchRect: { x: number; y: number; width: number; height: number };
  size: { width: number; height: number };
}

export interface PromoProps extends Record<string, unknown> {
  variant: "landscape" | "portrait";
  footage: FootageManifest | null;
  popup: PopupManifest | null;
}
