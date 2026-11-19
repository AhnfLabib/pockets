import { describe, it, expect } from 'vitest';
import { isExtensionPage } from '../../src/background/sender';

const root = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/';
describe('isExtensionPage', () => {
  it('accepts the extension popup and options pages', () => {
    expect(isExtensionPage(root + 'popup.html', root)).toBe(true);
    expect(isExtensionPage(root + 'options.html', root)).toBe(true);
  });
  it('rejects web pages, other extensions, and a missing url', () => {
    expect(isExtensionPage('https://evil.com/', root)).toBe(false);
    expect(isExtensionPage('https://evil.com/' + root, root)).toBe(false);
    expect(isExtensionPage('chrome-extension://zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz/popup.html', root)).toBe(false);
    expect(isExtensionPage(undefined, root)).toBe(false);
    expect(isExtensionPage(root + 'x', '')).toBe(false);
  });
});
