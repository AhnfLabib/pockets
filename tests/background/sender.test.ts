import { describe, it, expect } from 'vitest';
import { canUndo, isExtensionPage } from '../../src/background/sender';

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

describe('canUndo', () => {
  const taken = { noticeTabId: 7 };
  it('extension page: true', () => expect(canUndo({ url: root + 'options.html', frameId: 0 }, taken, root)).toBe(true));
  it('notice tab top frame: true', () => expect(canUndo({ url: 'https://a.com/', frameId: 0, tab: { id: 7 } }, taken, root)).toBe(true));
  it('notice tab child frame: false', () => expect(canUndo({ url: 'https://a.com/', frameId: 3, tab: { id: 7 } }, taken, root)).toBe(false));
  it('a different tab: false', () => expect(canUndo({ url: 'https://a.com/', frameId: 0, tab: { id: 8 } }, taken, root)).toBe(false));
  it('unknown takenAt: false', () => expect(canUndo({ url: root + 'x', frameId: 0 }, undefined, root)).toBe(false));
  it('no recorded notice tab: false for web pages', () => expect(canUndo({ url: 'https://a.com/', frameId: 0, tab: { id: 7 } }, {}, root)).toBe(false));
});
