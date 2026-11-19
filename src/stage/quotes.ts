// What Pockets may say as he comes in. Edit freely: every line must fit the bubble in two lines (tests check it).

/** Any visit. */
export const GENERAL_QUOTES: readonly string[] = [
  "Don't mind me.",
  'Ooh. Shiny tab.',
  'Finders keepers.',
  'Just passing through…',
  "You weren't using that, were you?",
  'Shh.',
  'Mine. Probably.',
  'Nobody will notice.',
];

/** Visits for a distracting tab only (in place of the general lines). */
export const DISTRACTING_QUOTES: readonly string[] = [
  'Back to work.',
  'Caught you.',
  'Not on my watch.',
  "I'll hold onto this.",
];

/** Twists on famous movie and TV lines, mixed into every visit's pool. */
export const RIFF_QUOTES: readonly string[] = [
  "I'll be back. For your other tabs.",
  "Here's Pockets!",
  "You can't handle the tabs!",
  'Houston, we have a tab problem.',
  'I see unused tabs.',
  'Show me the tabs!',
  'Say hello to my little paws.',
  'Nobody puts Pockets in a corner.',
  'To infinity and… your tab bar.',
  'Just keep scrolling.',
  'One does not simply keep forty tabs open.',
  "I'm making you an offer: keep it, or lose it.",
];

/** All the lists, for editing in one place and for the fit test. */
export const QUOTES = { general: GENERAL_QUOTES, distracting: DISTRACTING_QUOTES, riffs: RIFF_QUOTES } as const;

/** The lines a visit may draw from. */
export function quotePool(reason: 'stale' | 'distracting'): readonly string[] {
  return [...(reason === 'distracting' ? DISTRACTING_QUOTES : GENERAL_QUOTES), ...RIFF_QUOTES];
}

/** Bubble geometry shared with card.ts's CSS. The text is 13px DM Sans, weight 500. */
export const BUBBLE_MAX_WIDTH = 220;
export const BUBBLE_PAD_X = 11;
export const BUBBLE_FONT_PX = 13;
export const BUBBLE_LINE_PX = 17;
/** A generous average advance for 13px DM Sans (measured average is about 6.3 px), used for the fit budget. */
export const BUBBLE_CHAR_PX = 7.2;
/** How long the bubble stays up. */
export const QUOTE_MS = 2000;

/** How many lines `text` wraps to at the bubble's max width, with every character BUBBLE_CHAR_PX wide. */
export function bubbleLines(text: string): number {
  const inner = BUBBLE_MAX_WIDTH - 2 * BUBBLE_PAD_X - 2;
  const perLine = Math.floor(inner / BUBBLE_CHAR_PX);
  let lines = 1;
  let used = 0;
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const need = used === 0 ? word.length : used + 1 + word.length;
    if (need <= perLine) used = need;
    else { lines++; used = word.length; }
    if (word.length > perLine) lines += Math.ceil(word.length / perLine) - 1;
  }
  return lines;
}
