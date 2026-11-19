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
