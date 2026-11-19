// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { markTab, unmarkTab } from '../../src/content/mark';

const URL1 = 'data:image/png;base64,SUNPTg==';

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

describe('markTab: no icon, and the liveness guard', () => {
  beforeEach(() => {
    document.head.innerHTML = '<link rel="icon" href="/a.ico"><title>My Page</title>';
  });

  it('with no icon only the title changes; the page icon stays and is untouched on unmark', () => {
    const before = document.head.innerHTML;
    markTab(document, 5, null);
    expect(document.title).toBe('Mine in 5…');
    expect(document.querySelectorAll('link[rel~="icon"]').length).toBe(1);
    expect(document.querySelector<HTMLLinkElement>('link[rel~="icon"]')!.getAttribute('href')).toBe('/a.ico');
    unmarkTab(document);
    expect(document.head.innerHTML).toBe(before);
  });

  it('an icon arriving on a later mark swaps the icon then', () => {
    markTab(document, 5, null);
    markTab(document, 4, URL1);
    const links = document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]');
    expect(links.length).toBe(1);
    expect(links[0].href).toBe(URL1);
    unmarkTab(document);
    expect(document.querySelector<HTMLLinkElement>('link[rel~="icon"]')!.getAttribute('href')).toBe('/a.ico');
  });

  it('the title observer does nothing once the guard says the marking instance is dead', async () => {
    let alive = true;
    markTab(document, 5, URL1, () => alive);
    alive = false;
    document.title = 'Page changed it';
    await new Promise((r) => setTimeout(r, 0));
    expect(document.title).toBe('Page changed it');
    unmarkTab(document);
    expect(document.title).toBe('Page changed it');
  });
});

describe('markTab: icon updates and a CSP that refuses the icon', () => {
  const violation = (blockedURI: string, effectiveDirective: string) =>
    Object.assign(new Event('securitypolicyviolation'), { blockedURI, effectiveDirective, violatedDirective: effectiveDirective });

  it('sets the icon href only when it changes', () => {
    document.head.innerHTML = '<title>My Page</title>';
    markTab(document, 5, URL1);
    const link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]')!;
    let sets = 0;
    const desc = Object.getOwnPropertyDescriptor(HTMLLinkElement.prototype, 'href')!;
    Object.defineProperty(link, 'href', { configurable: true, get() { return desc.get!.call(this); }, set(v) { sets++; desc.set!.call(this, v); } });
    markTab(document, 4, URL1);
    markTab(document, 3, URL1);
    expect(sets).toBe(0);
    markTab(document, 2, 'data:image/png;base64,T1RIRVI=');
    expect(sets).toBe(1);
    unmarkTab(document);
  });

  it('a violation naming our data: icon puts the page icons back and later ticks stay title-only', () => {
    const doc = document.implementation.createHTMLDocument('x');
    doc.head.innerHTML = '<link rel="icon" href="/a.ico"><title>My Page</title>';
    const before = doc.head.innerHTML;
    markTab(doc, 5, URL1);
    doc.dispatchEvent(violation('https://other/x.png', 'img-src'));
    expect(doc.querySelector<HTMLLinkElement>('link[rel~="icon"]')!.getAttribute('href')).toBe(URL1);
    doc.dispatchEvent(violation('data', 'img-src'));
    expect(Array.from(doc.querySelectorAll('link[rel~="icon"]')).map((l) => l.getAttribute('href'))).toEqual(['/a.ico']);
    markTab(doc, 4, URL1);
    expect(doc.title).toBe('Mine in 4…');
    expect(Array.from(doc.querySelectorAll('link[rel~="icon"]')).map((l) => l.getAttribute('href'))).toEqual(['/a.ico']);
    unmarkTab(doc);
    expect(doc.head.innerHTML).toBe(before);
    // Still refused for the rest of this page.
    markTab(doc, 3, URL1);
    expect(doc.querySelectorAll('link[rel~="icon"]').length).toBe(1);
    unmarkTab(doc);
  });

  it('default-src stands in for img-src; other directives are ignored', () => {
    const a = document.implementation.createHTMLDocument('a');
    markTab(a, 5, URL1);
    a.dispatchEvent(violation('data', 'script-src'));
    expect(a.querySelectorAll('link[rel~="icon"]').length).toBe(1);
    a.dispatchEvent(violation('data', 'default-src'));
    expect(a.querySelectorAll('link[rel~="icon"]').length).toBe(0);
    unmarkTab(a);
  });
});
