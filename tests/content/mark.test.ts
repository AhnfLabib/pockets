// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { markTab, unmarkTab } from '../../src/content/mark';

const URL1 = 'chrome-extension://x/assets/icons/icon-32.png';

describe('markTab', () => {
  beforeEach(() => {
    document.head.innerHTML = '<title>My Page</title>';
  });

  it('sets title and icon, updates the number', () => {
    markTab(document, 5, URL1);
    expect(document.title).toBe('Mine in 5…');
    expect(document.querySelector<HTMLLinkElement>('link[rel~="icon"]')!.href).toBe(URL1);
    markTab(document, 4, URL1);
    expect(document.title).toBe('Mine in 4…');
    expect(document.querySelectorAll('link[rel~="icon"]').length).toBe(1);
  });

  it('restores original title and icon links exactly', () => {
    document.head.innerHTML = '<link rel="icon" href="/a.ico"><title>My Page</title><link rel="shortcut icon" href="/b.ico">';
    const before = document.head.innerHTML;
    markTab(document, 5, URL1);
    unmarkTab(document);
    expect(document.title).toBe('My Page');
    expect(document.head.innerHTML).toBe(before);
  });

  it('restores a page with no icon link to having none', () => {
    markTab(document, 5, URL1);
    unmarkTab(document);
    expect(document.querySelector('link[rel~="icon"]')).toBeNull();
  });

  it('restores the page newest title if it changed while marked', async () => {
    markTab(document, 5, URL1);
    document.title = 'Page changed it';
    await new Promise((r) => setTimeout(r, 0));
    markTab(document, 4, URL1);
    unmarkTab(document);
    expect(document.title).toBe('Page changed it');
  });
});
