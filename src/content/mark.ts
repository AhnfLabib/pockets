// Swaps the tab's title and icon to show the countdown, and puts the page's own back afterwards.
// DOM only: unmarkTab is safe to call from an orphaned content script whose extension context is dead.
interface Saved {
  title: string;
  ours: string;
  icons: { el: Element; parent: Node; next: Node | null }[];
  link: HTMLLinkElement | null;
  observer: MutationObserver | null;
  madeTitle: boolean;
  /** The marking instance's liveness gate. The observer asks it first; when it says no, the observer does nothing
   *  (the gate disposes that instance, which unmarks). */
  guard: (() => boolean) | null;
}
const saved = new WeakMap<Document, Saved>();

const label = (n: number) => `Mine in ${n}…`;

/**
 * Shows "Mine in {remaining}…" as the tab title and `iconUrl` (a data: URL) as its icon. With no icon, only the title
 * changes and the page's icons stay. `guard` is checked before the title observer acts.
 */
export function markTab(doc: Document, remaining: number, iconUrl: string | null, guard?: () => boolean): void {
  let s = saved.get(doc);
  if (!s) {
    s = { title: doc.title, ours: '', icons: [], link: null, observer: null, madeTitle: !doc.querySelector('title'), guard: null };
    saved.set(doc, s);
  }
  s.guard = guard ?? null;
  if (iconUrl) {
    if (!s.link) {
      const found = Array.from(doc.querySelectorAll('link[rel~="icon"], link[rel="shortcut icon"]'));
      for (const el of found.reverse()) {
        s.icons.push({ el, parent: el.parentNode!, next: el.nextSibling });
        el.remove();
      }
      const link = doc.createElement('link');
      link.rel = 'icon';
      s.link = link;
      (doc.head ?? doc.documentElement).appendChild(link);
    }
    s.link.href = iconUrl;
  }
  s.ours = label(remaining);
  doc.title = s.ours;
  if (!s.observer && typeof MutationObserver !== 'undefined') {
    const st = s;
    const titleEl = doc.querySelector('title');
    if (titleEl) {
      st.observer = new MutationObserver(() => {
        if (st.guard && !st.guard()) return;
        if (doc.title !== st.ours) {
          st.title = doc.title;
          doc.title = st.ours;
        }
      });
      st.observer.observe(titleEl, { childList: true, characterData: true, subtree: true });
    }
  }
}

export function unmarkTab(doc: Document): void {
  const s = saved.get(doc);
  if (!s) return;
  saved.delete(doc);
  s.observer?.takeRecords();
  s.observer?.disconnect();
  s.link?.remove();
  // Removed last-first, so restore first-last to land each back before its recorded neighbour.
  for (const { el, parent, next } of s.icons.slice().reverse()) parent.insertBefore(el, next && next.parentNode === parent ? next : null);
  // The page may have changed its title between the last mutation callback and now.
  if (doc.title !== s.ours) s.title = doc.title;
  if (s.madeTitle && !s.title) doc.querySelector('title')?.remove();
  else doc.title = s.title;
}
