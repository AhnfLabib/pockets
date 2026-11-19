import { describe, expect, it } from 'vitest';
import { cleanTitle } from '../../src/shared/title';

describe('cleanTitle', () => {
  it('strips a leading unread count', () => {
    expect(cleanTitle('(3) YouTube')).toBe('YouTube');
    expect(cleanTitle('(99+) Inbox')).toBe('Inbox');
    expect(cleanTitle('(12+) Feed')).toBe('Feed');
    expect(cleanTitle('[2] Chat')).toBe('Chat');
    expect(cleanTitle('  (1,204) Mail  ')).toBe('Mail');
  });

  it('leaves other parentheses alone', () => {
    expect(cleanTitle('Report (draft)')).toBe('Report (draft)');
    expect(cleanTitle('(draft) Report')).toBe('(draft) Report');
    expect(cleanTitle('(3] Odd')).toBe('(3] Odd');
    expect(cleanTitle('YouTube')).toBe('YouTube');
  });

  it('keeps a title that is only a count rather than returning an empty string', () => {
    expect(cleanTitle('(3)')).toBe('(3)');
    expect(cleanTitle('[12+]')).toBe('[12+]');
  });

  it('strips only one leading count and trims', () => {
    expect(cleanTitle('(3) (draft) Q3')).toBe('(draft) Q3');
    expect(cleanTitle('')).toBe('');
  });
});
