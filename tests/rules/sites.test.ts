import { describe, it, expect } from 'vitest';
import { siteOf, matchesSite } from '../../src/rules/sites';

describe('siteOf', () => {
  it('lower-cases and strips www.', () => {
    expect(siteOf('https://www.YouTube.com/watch')).toBe('youtube.com');
  });
  it('returns null for non-http(s) and garbage without throwing', () => {
    for (const u of ['chrome://newtab', 'file:///x', 'about:blank', 'data:text/html,x', '', 'not a url']) {
      expect(siteOf(u)).toBeNull();
    }
  });
});

describe('matchesSite', () => {
  it('matches subdomains', () => {
    expect(matchesSite('https://m.youtube.com/', ['youtube.com'])).toBe(true);
  });
  it('matches the exact host', () => {
    expect(matchesSite('https://youtube.com/', ['youtube.com'])).toBe(true);
  });
  it('does not match a lookalike host', () => {
    expect(matchesSite('https://notyoutube.com/', ['youtube.com'])).toBe(false);
  });
  it('never matches a null-site URL', () => {
    expect(matchesSite('chrome://newtab', ['youtube.com', 'newtab'])).toBe(false);
    expect(matchesSite('about:blank', [''])).toBe(false);
  });
});
