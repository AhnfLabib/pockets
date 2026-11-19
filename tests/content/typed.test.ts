// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { watchTyping } from '../../src/content/typed';

function fire(el: Element) {
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('watchTyping', () => {
  beforeEach(() => { document.body.innerHTML = '<input id="t"><textarea id="a"></textarea><div id="c" contenteditable="true"></div><input id="s" type="search"><input id="p" type="password">'; });

  it('fires once on first input in a text field', () => {
    const f = vi.fn();
    watchTyping(document, f);
    fire(document.getElementById('t')!);
    fire(document.getElementById('a')!);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('fires for textarea and contenteditable', () => {
    const f = vi.fn();
    watchTyping(document, f);
    fire(document.getElementById('c')!);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('ignores focus alone and search fields', () => {
    const f = vi.fn();
    watchTyping(document, f);
    document.getElementById('t')!.dispatchEvent(new Event('focus'));
    document.getElementById('t')!.dispatchEvent(new Event('focusin', { bubbles: true }));
    fire(document.getElementById('s')!);
    expect(f).not.toHaveBeenCalled();
  });

  it('counts typing in a password field', () => {
    const f = vi.fn();
    watchTyping(document, f);
    fire(document.getElementById('p')!);
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe('watchTyping extras', () => {
  it('counts input inside an open shadow root', () => {
    document.body.innerHTML = '<div id="h"></div>';
    const root = document.getElementById('h')!.attachShadow({ mode: 'open' });
    root.innerHTML = '<input id="x">';
    const f = vi.fn();
    watchTyping(document, f);
    root.getElementById('x')!.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('retries on the next input when the first send failed', async () => {
    document.body.innerHTML = '<input id="t">';
    const f = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
    watchTyping(document, f);
    const el = document.getElementById('t')!;
    fire(el);
    await new Promise((r) => setTimeout(r, 0));
    fire(el);
    await new Promise((r) => setTimeout(r, 0));
    fire(el);
    expect(f).toHaveBeenCalledTimes(2);
  });
});
