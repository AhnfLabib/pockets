// The settings page: tuning numbers, the two site lists, and everything Pockets has taken.
import type { Store, TakenTab } from '../background/store';
import type { Settings } from '../shared/types';
import { siteOf } from '../rules/sites';

export interface OptionsDeps { store: Store; undo: (takenAt: number) => void }

type NumKey = 'staleHours' | 'gapMinutes' | 'stalePerHour' | 'countdownSeconds';
type ListKey = 'distracting' | 'neverTake';

const NUMBERS: { key: NumKey; label: string; min: number; max: number }[] = [
  { key: 'staleHours', label: 'Take tabs not opened for (hours)', min: 1, max: 720 },
  { key: 'gapMinutes', label: 'Wait between visits (minutes)', min: 1, max: 240 },
  { key: 'stalePerHour', label: 'Stale tabs per hour (0 turns this off)', min: 0, max: 60 },
  { key: 'countdownSeconds', label: 'Countdown (seconds)', min: 3, max: 30 },
];

const LISTS: { key: ListKey; label: string; hint: string }[] = [
  { key: 'distracting', label: 'Distracting sites', hint: 'Pockets goes for these first.' },
  { key: 'neverTake', label: 'Never take', hint: 'Hands off. Pockets will not touch these.' },
];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
}

/** A bare host or a pasted URL, as a site. Null when it is not a website. */
function toSite(input: string): string | null {
  const s = input.trim();
  if (!s || /\s/.test(s)) return null;
  const site = siteOf(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`);
  if (!site || !site.includes('.')) return null;
  return site;
}

export async function renderOptions(root: HTMLElement, deps: OptionsDeps): Promise<void> {
  const { store, undo } = deps;
  let settings: Settings = await store.settings();

  async function save(patch: Partial<Settings>): Promise<void> {
    await store.saveSettings({ ...(await store.settings()), ...patch });
    settings = await store.settings();
  }

  root.replaceChildren();
  const page = el('main', { class: 'page' });
  page.append(el('h1', {}, 'Pockets'), el('p', { class: 'lede' }, 'Tune how the raccoon works. Changes save as you make them.'));

  // Numbers
  const numbers = el('section', { 'aria-labelledby': 'h-timing' });
  numbers.append(el('h2', { id: 'h-timing' }, 'Timing'));
  for (const n of NUMBERS) {
    const row = el('div', { class: 'field' });
    const id = `f-${n.key}`;
    const input = el('input', { id, name: n.key, type: 'number', min: String(n.min), max: String(n.max), step: '1', inputmode: 'numeric' });
    input.value = String(settings[n.key]);
    input.addEventListener('change', async () => {
      const entered = input.value.trim() === '' ? NaN : Number(input.value);
      await save({ [n.key]: Number.isFinite(entered) ? Math.round(entered) : NaN } as Partial<Settings>);
      input.value = String(settings[n.key]);
    });
    row.append(el('label', { for: id }, n.label), input);
    numbers.append(row);
  }
  page.append(numbers);

  // Site lists
  for (const l of LISTS) {
    const sec = el('section', { 'data-list': l.key, 'aria-labelledby': `h-${l.key}` });
    sec.append(el('h2', { id: `h-${l.key}` }, l.label), el('p', { class: 'hint' }, l.hint));
    const ul = el('ul', { class: 'sites' });
    const form = el('form', { class: 'add', novalidate: '' });
    const inputId = `add-${l.key}`;
    const input = el('input', { id: inputId, type: 'text', autocomplete: 'off', spellcheck: 'false', placeholder: 'example.com', 'aria-describedby': `err-${l.key}` });
    const err = el('p', { id: `err-${l.key}`, class: 'error', role: 'alert' });
    form.append(el('label', { for: inputId }, `Add to ${l.label.toLowerCase()}`), input, el('button', { type: 'submit' }, 'Add'));

    const paint = () => {
      ul.replaceChildren();
      if (settings[l.key].length === 0) ul.append(el('li', { class: 'none' }, 'Nothing here.'));
      for (const site of settings[l.key]) {
        const li = el('li');
        const rm = el('button', { type: 'button', class: 'remove', 'data-site': site, 'aria-label': `Remove ${site}` }, 'Remove');
        rm.addEventListener('click', async () => {
          await save({ [l.key]: settings[l.key].filter((s) => s !== site) } as Partial<Settings>);
          paint();
        });
        li.append(el('span', {}, site), rm);
        ul.append(li);
      }
    };
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const site = toSite(input.value);
      if (!site) {
        err.textContent = "That doesn't look like a website.";
        input.setAttribute('aria-invalid', 'true');
        return;
      }
      err.textContent = '';
      input.removeAttribute('aria-invalid');
      if (!settings[l.key].includes(site)) await save({ [l.key]: [...settings[l.key], site] } as Partial<Settings>);
      input.value = '';
      paint();
    });
    paint();
    sec.append(ul, form, err);
    page.append(sec);
  }

  // Taken
  const takenSec = el('section', { 'aria-labelledby': 'h-taken' });
  takenSec.append(el('h2', { id: 'h-taken' }, 'What Pockets took'));
  const takenList = el('ul', { class: 'taken' });
  takenSec.append(takenList);
  page.append(takenSec);

  async function paintTaken(): Promise<void> {
    const items: TakenTab[] = (await store.taken()).slice().sort((a, b) => b.takenAt - a.takenAt);
    takenList.replaceChildren();
    if (items.length === 0) {
      takenList.append(el('li', { class: 'none' }, "Pockets hasn't taken anything yet."));
      return;
    }
    for (const t of items) {
      const li = el('li', { 'data-taken': String(t.takenAt) });
      const info = el('div', { class: 'info' });
      info.append(
        el('span', { class: 'title' }, t.title || t.url),
        el('span', { class: 'meta' }, `${siteOf(t.url) ?? t.url} · ${t.reason === 'stale' ? 'stale' : 'distracting'} · ${new Date(t.takenAt).toLocaleString()}`),
      );
      const btn = el('button', { type: 'button' }, 'Reopen');
      btn.addEventListener('click', () => {
        btn.disabled = true;
        undo(t.takenAt);
        setTimeout(() => { void paintTaken(); }, 700);
      });
      li.append(info, btn);
      takenList.append(li);
    }
  }
  await paintTaken();

  root.append(page);
}
