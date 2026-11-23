// The intro video's whole timeline, in composition frames (30 fps). The composition, the storyboard and the stills
// script (intro/stills.mjs, which imports this file with Node's type stripping) all read it, so the storyboard's
// times and captions are the video's. Keep this file free of imports and non-erasable TypeScript.

export const FPS = 30;
/** Crossfade between scenes, in frames. */
export const FADE = 10;

/**
 * The demo is one continuous shot of the crowded character page (footage "intro", seed 1). Its comp-time beats:
 * the climb runs from 0 to `card` (sped up, at most 2x), the warning card counts down at real speed for
 * `countdown` frames, the take and bolt run at real speed and the Undo click lands `undoAfter` frames after the take.
 */
export const DEMO = {
  /** Footage frame shown at comp frame 0: Pockets already poking his head in, so the hook has him at once. */
  footStart: 18,
  /** Comp frame where the quote bubble has been on screen long enough to read; the climb plays 1.5x up to here. */
  quoteHold: 40,
  /** Comp frame of card-shown; between quoteHold and here the climb plays at about 2x. */
  card: 70,
  countdown: 150,
  undoAfter: 54,
  /** After the Undo click: the tab drops back on the bar and the caption holds. */
  tail: 50,
};
const demoLen = DEMO.card + DEMO.countdown + DEMO.undoAfter + DEMO.tail;
export const TAKE = DEMO.card + DEMO.countdown;
export const UNDO = TAKE + DEMO.undoAfter;

export type SceneId = 'demo' | 'rules' | 'working' | 'trust' | 'end';
/** Scene lengths include the FADE frames each overlaps the next. */
export const SCENES: { id: SceneId; frames: number }[] = [
  { id: 'demo', frames: demoLen },
  { id: 'rules', frames: 78 },
  { id: 'working', frames: 84 },
  { id: 'trust', frames: 72 },
  { id: 'end', frames: 120 },
];
export const DURATION = SCENES.reduce((a, s) => a + s.frames, 0) - (SCENES.length - 1) * FADE;

/** Absolute comp frame where a scene starts (its fade-in begins here). */
export function sceneStart(id: SceneId): number {
  let t = 0;
  for (const s of SCENES) {
    if (s.id === id) return t;
    t += s.frames - FADE;
  }
  throw new Error(`no scene ${id}`);
}

/** Every caption on screen, with its scene-relative in and out frames (out undefined: holds to the scene's end). */
export interface Line { scene: SceneId; from: number; to?: number; text: string; sub?: string }
export const LINES: Line[] = [
  { scene: 'demo', from: 0, to: DEMO.card, text: 'Too many tabs?', sub: 'Meet Pockets.' },
  { scene: 'demo', from: DEMO.card, to: DEMO.card + 75, text: 'He gives you five seconds.' },
  { scene: 'demo', from: DEMO.card + 75, to: TAKE, text: 'Keep the tab, or it’s his.' },
  { scene: 'demo', from: TAKE, to: UNDO, text: 'He takes it and runs.' },
  { scene: 'demo', from: UNDO, text: 'Undo brings it back.' },
  { scene: 'rules', from: 0, text: 'Pockets never takes', sub: 'Pinned tabs · Tabs you’ve typed in · Your last tab' },
  { scene: 'working', from: 0, text: 'Working mode', sub: 'Distracting sites get taken too.' },
  { scene: 'trust', from: 0, text: 'Everything stays in your browser.', sub: 'No accounts. No servers.\nNo tracking.' },
  { scene: 'end', from: 0, text: 'Pockets: the tab-stealing raccoon', sub: 'Available on the Chrome Web Store' },
];

/** Storyboard key frames (absolute comp frames) with what each shows. */
export const STORYBOARD: { frame: number; label: string }[] = [
  { frame: 0, label: 'Hook: 32 cramped tabs' },
  { frame: 30, label: 'Climbs in, quote (1.5x)' },
  { frame: DEMO.card + 12, label: 'Warning card, real speed' },
  { frame: DEMO.card + 105, label: 'Countdown: Mine in 2…' },
  { frame: TAKE + 23, label: 'The steal: tab in his mouth' },
  { frame: UNDO + 30, label: 'Undo: YouTube is back' },
  { frame: sceneStart('rules') + 50, label: 'Never takes...' },
  { frame: sceneStart('working') + 55, label: 'Working mode' },
  { frame: sceneStart('trust') + 45, label: 'Stays in your browser' },
  { frame: sceneStart('end') + 60, label: 'End card' },
];

/** LinkedIn stills: absolute comp frame, and the top of the 1080x1080 square cut from the 1920-tall frame. */
export const STILLS: { name: string; frame: number; squareTop: number }[] = [
  { name: '1-hook', frame: 50, squareTop: 150 },
  { name: '2-warning', frame: DEMO.card + 20, squareTop: 190 },
  { name: '3-steal', frame: TAKE + 23, squareTop: 150 },
  { name: '4-end', frame: sceneStart('end') + 80, squareTop: 400 },
];
