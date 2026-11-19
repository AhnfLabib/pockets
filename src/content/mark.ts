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
  /** Removes the CSP violation listener (set while our icon is in the page). */
  stopCsp: (() => void) | null;
}
const saved = new WeakMap<Document, Saved>();
/** Documents whose CSP refused our data: icon: for the rest of the page, marks are title-only. */
const iconRefused = new WeakSet<Document>();

/** Takes our icon link out and puts the page's own icons back where they were. */
function restoreIcons(s: Saved): void {
  s.stopCsp?.();
  s.stopCsp = null;
  s.link?.remove();
  s.link = null;
  // Removed last-first, so restore first-last to land each back before its recorded neighbour.
  for (const { el, parent, next } of s.icons.slice().reverse()) parent.insertBefore(el, next && next.parentNode === parent ? next : null);
  s.icons = [];
}

/** A CSP violation for our data: icon (img-src, or default-src standing in for it). */
function refusesOurIcon(e: Event): boolean {
  const v = e as Partial<SecurityPolicyViolationEvent>;
  const directive = `${v.effectiveDirective ?? ''} ${v.violatedDirective ?? ''}`;
  return typeof v.blockedURI === 'string' && v.blockedURI.startsWith('data') && /\b(img-src|default-src)\b/.test(directive);
}

const label = (n: number) => `Mine in ${n}…`;

/**
 * Shows "Mine in {remaining}…" as the tab title and `iconUrl` (a data: URL) as its icon. With no icon, only the title
 * changes and the page's icons stay. `guard` is checked before the title observer acts.
 */
export function markTab(doc: Document, remaining: number, iconUrl: string | null, guard?: () => boolean): void {
  let s = saved.get(doc);
  if (!s) {
    s = { title: doc.title, ours: '', icons: [], link: null, observer: null, madeTitle: !doc.querySelector('title'), guard: null, stopCsp: null };
    saved.set(doc, s);
  }
  s.guard = guard ?? null;
  if (iconUrl && !iconRefused.has(doc)) {
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
      // A page CSP that closes img-src refuses the data: icon (the browser loads <link rel=icon> for the page). Then
      // stop swapping it for the rest of this page and give the page its own icons back; the title still counts down.
      const st = s;
      const onViolation = (e: Event) => {
        if (st.guard && !st.guard()) return;
        if (!st.link || !refusesOurIcon(e)) return;
        iconRefused.add(doc);
        restoreIcons(st);
      };
      doc.addEventListener('securitypolicyviolation', onViolation);
      s.stopCsp = () => doc.removeEventListener('securitypolicyviolation', onViolation);
    }
    // Only on a change: each assignment makes the browser load the icon again (and, on a refusing page, log again).
    if (s.link.getAttribute('href') !== iconUrl) s.link.href = iconUrl;
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
  restoreIcons(s);
  // The page may have changed its title between the last mutation callback and now.
  if (doc.title !== s.ours) s.title = doc.title;
  if (s.madeTitle && !s.title) doc.querySelector('title')?.remove();
  else doc.title = s.title;
}
