import { describe, expect, it } from 'vitest';
import { BUBBLE_CHAR_PX, BUBBLE_FONT_PX, bubbleLines, DISTRACTING_QUOTES, GENERAL_QUOTES, QUOTES, RIFF_QUOTES, quotePool } from '../../src/stage/quotes';

describe('quotes', () => {
  it('has the general, distracting and riff lists, exported for editing', () => {
    expect(GENERAL_QUOTES).toHaveLength(8);
    expect(DISTRACTING_QUOTES).toHaveLength(4);
    expect(RIFF_QUOTES).toHaveLength(12);
    expect(QUOTES).toEqual({ general: GENERAL_QUOTES, distracting: DISTRACTING_QUOTES, riffs: RIFF_QUOTES });
  });

  it('mixes the riffs into both pools, and keeps the general lines out of distracting visits', () => {
    expect(quotePool('stale')).toEqual([...GENERAL_QUOTES, ...RIFF_QUOTES]);
    expect(quotePool('distracting')).toEqual([...DISTRACTING_QUOTES, ...RIFF_QUOTES]);
  });

  it('every line in every list wraps to at most two lines in the bubble', () => {
    // The budget assumes every character is BUBBLE_CHAR_PX wide: wider than DM Sans' average at 13 px (about 0.49em).
    expect(BUBBLE_CHAR_PX / BUBBLE_FONT_PX).toBeGreaterThan(0.5);
    for (const line of [...GENERAL_QUOTES, ...DISTRACTING_QUOTES, ...RIFF_QUOTES]) expect(bubbleLines(line), line).toBeLessThanOrEqual(2);
  });

  it('counts lines by word wrap', () => {
    expect(bubbleLines('Shh.')).toBe(1);
    expect(bubbleLines('word '.repeat(20).trim())).toBeGreaterThan(2);
  });
});
