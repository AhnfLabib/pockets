// The heist cut's whole timeline, generated from the music's beat analysis (beats.json, written by
// scripts/heist-beats.py). Nothing here is a fixed time: every cut, caption change and action hit is a beat index,
// and the beat indices are placed relative to the track's phrase accents. Re-analyse the track and the edit re-times.
import beats from "./beats.json";

export const FPS = 30;
export type Beat = (typeof beats.beats)[number];
export const BEATS: Beat[] = beats.beats;
export const BPM = beats.bpm;
/** Track seconds at video time 0 (the render trims the decoded track sample-accurately there). */
export const OFFSET = beats.offset;

/** Frame of beat k (from absolute time, never cumulative). Beats past the analysis are extrapolated on the grid. */
export const B = (k: number): number => {
  const b = BEATS[k];
  if (b) return b.frame;
  return Math.round((BEATS[0].t + k * beats.period) * FPS);
};

// Phrase accents: the big hits that open each phrase. Only audible ones (the track rings out at the end).
const PA = beats.phraseAccents.map((a) => a.i);
const acc = (i: number) => beats.phraseAccents.find((a) => a.i === i)!.accent;

// The steal and Undo sit on the strongest adjacent pair of phrase accents in the middle of the story (6-14 s).
let pair: [number, number] = [PA[2], PA[3]];
let best = -1;
for (let j = 0; j + 1 < PA.length; j++) {
  const [a, b] = [PA[j], PA[j + 1]];
  const ta = BEATS[a].t, tb = BEATS[b].t;
  if (ta >= 6 && tb <= 14.5 && acc(a) + acc(b) > best) {
    best = acc(a) + acc(b);
    pair = [a, b];
  }
}
/** Beat of the steal (the hard cut to him bolting with the tab). */
export const STEAL = pair[0];
/** Beat of the Undo click. */
export const UNDO = pair[1];
/** The final hit: the last phrase accent. The video ends just after it. */
export const FINAL = PA[PA.length - 1];
/** The end card arrives on the phrase accent before the final hit. */
export const ENDCARD = PA[PA.length - 2];
/** Tail after the final hit, in frames (a fade to black of the picture and the music). */
export const TAIL = 15;
export const DURATION = B(FINAL) + TAIL;

// Scene boundaries, in beats. The intro (spotlight, whip-pan, climb) shares the beats before the warning equally.
const WARN = STEAL - 8;
const intro = Math.max(3, Math.floor(WARN / 3));
const S7 = UNDO + 4;
const S9 = ENDCARD - 4;
export const SCENES = {
  spotlight: [0, intro],
  whip: [intro, 2 * intro],
  climb: [2 * intro, WARN],
  warning: [WARN, STEAL],
  steal: [STEAL, UNDO - 4],
  undo: [UNDO - 4, S7],
  pinned: [S7, S7 + 3],
  typing: [S7 + 3, S7 + 6],
  last: [S7 + 6, S7 + 9],
  working: [S7 + 9, S9],
  local: [S9, ENDCARD],
  end: [ENDCARD, FINAL],
} as const;
export type SceneName = keyof typeof SCENES;

/** Hard cuts inside scenes (each also a beat), on top of the scene boundaries. */
/** The warning's punch-in on the card (before the countdown starts). */
export const CARD_PUNCH = WARN + 2;
export const INNER_CUTS: { beat: number; what: string }[] = [
  { beat: CARD_PUNCH, what: "punch in on the card" },
  ...[5, 4, 3, 2, 1].map((n, i) => ({ beat: STEAL - 5 + i, what: `jump cut ${n}` })),
  { beat: UNDO, what: "Undo click: punch in" },
  { beat: UNDO + 2, what: "cut to the tab bar: YouTube pops back" },
  { beat: SCENES.working[0] + 4, what: "cut to the tab bar: spotlight swings to YouTube" },
];

export interface Line {
  /** Beat the line appears on. */
  beat: number;
  /** Beat it leaves on (the next caption change or scene end). */
  until: number;
  /** Lines of the caption; *word* is the red key word. */
  rows: string[];
}

const [w0, w1] = SCENES.working;
/** Captions: each row appears on its own beat (rows[i] at beat + i), all stay until `until`. */
export const CAPTIONS: Line[] = [
  { beat: 1, until: intro, rows: ["*47*", "tabs."] },
  { beat: intro, until: 2 * intro, rows: ["One of them", "is *mine.*"] },
  { beat: 2 * intro, until: WARN, rows: ["Meet", "*Pockets.*"] },
  { beat: WARN, until: STEAL, rows: ["You get", "*five*", "seconds."] },
  { beat: STEAL, until: UNDO - 4, rows: ["Then", "it's *his.*"] },
  { beat: UNDO - 4, until: UNDO, rows: ["Changed", "your mind?"] },
  { beat: UNDO, until: S7, rows: ["*Undo.*"] },
  { beat: S7, until: S7 + 3, rows: ["Not", "*pinned*", "tabs."] },
  { beat: S7 + 3, until: S7 + 6, rows: ["Not tabs", "you're", "*typing* in."] },
  { beat: S7 + 6, until: S7 + 9, rows: ["Not your", "*last*", "tab."] },
  { beat: w0, until: w0 + 3, rows: ["*Working?*"] },
  { beat: w0 + 3, until: w1, rows: ["Distractions", "are *fair game.*"] },
  { beat: S9, until: ENDCARD, rows: ["*Nothing*", "leaves your", "browser."] },
];

/**
 * The giant countdown during the warning: 5, 4, 3, 2, 1 on the five consecutive beats before the steal accent, so
 * the take lands on the accent right after "1". At each digit the footage jumps to the card's own tick, so the card's
 * "Mine in N..." always matches the big digit.
 */
export const COUNTDOWN: { n: number; beat: number }[] = [5, 4, 3, 2, 1].map((n, i) => ({ n, beat: STEAL - 5 + i }));

/** Every beat-synced event, for the beat map, heist.md and the sync check. */
export function events(): { frame: number; beat: number; kind: "cut" | "caption" | "hit"; what: string }[] {
  const out: { frame: number; beat: number; kind: "cut" | "caption" | "hit"; what: string }[] = [];
  for (const [name, [a]] of Object.entries(SCENES)) out.push({ beat: a, frame: B(a), kind: "cut", what: `scene: ${name}` });
  for (const c of INNER_CUTS) out.push({ beat: c.beat, frame: B(c.beat), kind: "cut", what: c.what });
  for (const l of CAPTIONS) l.rows.forEach((r, i) => out.push({ beat: l.beat + i, frame: B(l.beat + i), kind: "caption", what: r.replace(/\*/g, "") }));
  const extra: [number, string][] = [
    [SCENES.climb[0] + 2, "tag: TARGET: YouTube · IDLE 2 DAYS"],
    [SCENES.whip[0] + 1, "glow on the target tab"],
    ...COUNTDOWN.map((c): [number, string] => [c.beat, `countdown digit ${c.n}`]),
    [SCENES.working[0] + 5, "tag: DISTRACTION: YouTube"],
    [SCENES.local[0] + 1, "lock icon"],
    [ENDCARD + 1, "end card: POCKETS"],
    [ENDCARD + 2, "end card: the tab-stealing raccoon"],
    [ENDCARD + 4, "end card: Free on the Chrome Web Store"],
  ];
  for (const [beat, what] of extra) out.push({ beat, frame: B(beat), kind: "caption", what });
  out.push({ beat: STEAL, frame: B(STEAL), kind: "hit", what: "STEAL: hard cut to him bolting with the tab" });
  out.push({ beat: UNDO, frame: B(UNDO), kind: "hit", what: "UNDO: the click, the tab pops back" });
  out.push({ beat: ENDCARD, frame: B(ENDCARD), kind: "hit", what: "END CARD arrives" });
  out.push({ beat: FINAL, frame: B(FINAL), kind: "hit", what: "FINAL HIT: end-card punch, then the fade" });
  return out.sort((a, b) => a.frame - b.frame);
}
