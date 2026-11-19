// Swaps the tab's title and icon to show the countdown, and puts the page's own back afterwards.
interface Saved {
  title: string;
  ours: string;
  icons: { el: Element; parent: Node; next: Node | null }[];
  link: HTMLLinkElement;
  observer: MutationObserver | null;
  madeTitle: boolean;
}
const saved = new WeakMap<Document, Saved>();

const label = (n: number) => `Mine in ${n}…`;

export function markTab(doc: Document, remaining: number, iconUrl: string): void {
  let s = saved.get(doc);
  if (!s) {
    const icons: Saved['icons'] = [];
    const found = Array.from(doc.querySelectorAll('link[rel~="icon"], link[rel="shortcut icon"]'));
    for (const el of found.reverse()) {
      icons.push({ el, parent: el.parentNode!, next: el.nextSibling });
      el.remove();
    }
    const link = doc.createElement('link');
    link.rel = 'icon';
    s = { title: doc.title, ours: '', icons, link, observer: null, madeTitle: !doc.querySelector('title') };
    saved.set(doc, s);
    (doc.head ?? doc.documentElement).appendChild(link);
    const st = s;
  }
  s.link.href = iconUrl;
  s.ours = label(remaining);
  doc.title = s.ours;
  if (!s.observer && typeof MutationObserver !== 'undefined') {
    const st = s;
    const titleEl = doc.querySelector('title');
    if (titleEl) {
      st.observer = new MutationObserver(() => {
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
  s.link.remove();
  // Removed last-first, so restore first-last to land each back before its recorded neighbour.
  for (const { el, parent, next } of s.icons.slice().reverse()) parent.insertBefore(el, next && next.parentNode === parent ? next : null);
  // The page may have changed its title between the last mutation callback and now.
  if (doc.title !== s.ours) s.title = doc.title;
  if (s.madeTitle && !s.title) doc.querySelector('title')?.remove();
  else doc.title = s.title;
}
