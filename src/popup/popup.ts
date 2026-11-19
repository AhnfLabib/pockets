// The toolbar popup: working-mode switch, "add this site", and the five newest taken tabs.
// It never writes runtime state: the working switch asks the background, which owns those writes.
import type { Store, TakenTab } from '../background/store';
import { siteOf } from '../rules/sites';

export interface PopupDeps {
  store: Store;
  currentUrl: string | null;
  now: () => number;
  setWorking: (on: boolean) => Promise<void>;
  undo: (takenAt: number) => void;
  openOptions: () => void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
}

function ago(ms: number): string {
  const m = Math.floor(Math.max(0, ms) / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.floor(h / 24)} d ago`;
}

export async function renderPopup(root: HTMLElement, deps: PopupDeps): Promise<void> {
  const { store, currentUrl, now, setWorking, undo, openOptions } = deps;
  const rt = await store.runtime();
  const site = currentUrl ? siteOf(currentUrl) : null;

  root.replaceChildren();
  const page = el('main', { class: 'popup' });
  page.append(el('h1', {}, 'Pockets'));

  // Working mode
  const row = el('div', { class: 'row' });
  const label = el('label', { class: 'switch', for: 'working' });
  const input = el('input', { id: 'working', type: 'checkbox', role: 'switch', 'aria-label': 'Working mode' });
  input.checked = rt.working;
  const state = el('span', { class: 'state' }, rt.working ? 'Working' : 'Not working');
  label.append(input, el('span', { class: 'track', 'aria-hidden': 'true' }), state);
  input.addEventListener('change', async () => {
    const on = input.checked;
    state.textContent = on ? 'Working' : 'Not working';
    input.disabled = true;
    try {
      await setWorking(on);
    } catch {
      input.checked = !on;
      state.textContent = input.checked ? 'Working' : 'Not working';
    }
    input.disabled = false;
  });
  row.append(label);
  page.append(row, el('p', { class: 'hint' }, 'While you are working, Pockets goes for distracting sites.'));

  // Add this site
  const add = el('button', { type: 'button', class: 'add-site' }, 'Add this site');
  let listed = false;
  if (site) listed = (await store.settings()).distracting.includes(site);
  const paintAdd = () => {
    add.textContent = listed ? 'Added' : 'Add this site';
    add.disabled = !site || listed;
    if (site) add.setAttribute('title', site);
  };
  paintAdd();
  add.addEventListener('click', async () => {
    if (!site || listed) return;
    listed = true;
    paintAdd();
    const s = await store.settings();
    if (!s.distracting.includes(site)) await store.saveSettings({ ...s, distracting: [...s.distracting, site] });
  });
  page.append(add);

  // Taken
  const sec = el('section', { 'aria-labelledby': 'h-taken' });
  sec.append(el('h2', { id: 'h-taken' }, 'Recently taken'));
  const ul = el('ul', { class: 'taken' });
  sec.append(ul);
  page.append(sec);

  async function paintTaken(): Promise<void> {
    const list: TakenTab[] = (await store.taken()).slice().sort((a, b) => b.takenAt - a.takenAt).slice(0, 5);
    ul.replaceChildren();
    if (list.length === 0) {
      ul.append(el('li', { class: 'none' }, "Pockets hasn't taken anything yet."));
      return;
    }
    for (const t of list) {
      const li = el('li', { 'data-taken': String(t.takenAt) });
      const info = el('div', { class: 'info' });
      info.append(
        el('span', { class: 'title' }, t.title || t.url),
        el('span', { class: 'meta' }, `${siteOf(t.url) ?? t.url} · ${ago(now() - t.takenAt)}`),
      );
      const btn = el('button', { type: 'button' }, 'Reopen');
      btn.setAttribute('aria-label', `Reopen ${t.title || t.url}`);
      btn.addEventListener('click', () => {
        btn.disabled = true;
        undo(t.takenAt);
        setTimeout(() => { void paintTaken(); }, 700);
      });
      li.append(info, btn);
      ul.append(li);
    }
  }
  await paintTaken();

  const settings = el('a', { class: 'settings', href: '#' }, 'Settings');
  settings.addEventListener('click', (e) => { e.preventDefault(); openOptions(); });
  page.append(el('footer', {}, ''));
  page.lastElementChild!.append(settings);

  root.append(page);
}
