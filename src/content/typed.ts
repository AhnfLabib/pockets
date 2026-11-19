// Notices the first real typing on the page. Such a tab is never taken.
function isTextEntry(el: Element | null): boolean {
  if (!el || !el.tagName) return false;
  const tag = el.tagName;
  if (tag === 'TEXTAREA') return true;
  if (tag === 'INPUT') {
    const type = ((el as HTMLInputElement).type || 'text').toLowerCase();
    return type !== 'search' && type !== 'checkbox' && type !== 'radio' && type !== 'button' && type !== 'submit' && type !== 'range' && type !== 'color';
  }
  return (el as HTMLElement).isContentEditable === true || el.getAttribute('contenteditable') === 'true' || el.getAttribute('contenteditable') === '';
}

/**
 * Calls onFirst on the first `input` event in a text field, textarea or contenteditable (also inside open shadow
 * roots). If onFirst throws, rejects or returns false, the next input event tries again; otherwise it is done.
 */
export function watchTyping(doc: Document, onFirst: () => void | boolean | Promise<unknown>): void {
  let done = false;
  let inflight = false;
  const handler = (e: Event) => {
    if (done || inflight) return;
    const t = (typeof e.composedPath === 'function' ? e.composedPath()[0] : null) ?? e.target;
    if (!isTextEntry(t as Element | null)) return;
    inflight = true;
    let r: unknown;
    try {
      r = onFirst();
    } catch {
      r = false;
    }
    void Promise.resolve(r)
      .then((v) => {
        if (v !== false) {
          done = true;
          doc.removeEventListener('input', handler, true);
        }
      })
      .catch(() => {})
      .finally(() => { inflight = false; });
  };
  doc.addEventListener('input', handler, true);
}
