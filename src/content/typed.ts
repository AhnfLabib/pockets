// Notices the first real typing on the page. Such a tab is never taken.
function isTextEntry(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'TEXTAREA') return true;
  if (tag === 'INPUT') {
    const type = ((el as HTMLInputElement).type || 'text').toLowerCase();
    return type !== 'search' && type !== 'checkbox' && type !== 'radio' && type !== 'button' && type !== 'submit' && type !== 'range' && type !== 'color';
  }
  return (el as HTMLElement).isContentEditable === true || el.getAttribute('contenteditable') === 'true' || el.getAttribute('contenteditable') === '';
}

/** Calls onFirst once, on the first `input` event in a text field, textarea or contenteditable. */
export function watchTyping(doc: Document, onFirst: () => void): void {
  let done = false;
  const handler = (e: Event) => {
    if (done) return;
    const t = e.target as Element | null;
    if (!isTextEntry(t)) return;
    done = true;
    doc.removeEventListener('input', handler, true);
    onFirst();
  };
  doc.addEventListener('input', handler, true);
}
