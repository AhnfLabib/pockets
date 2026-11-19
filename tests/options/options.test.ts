// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Store, type KV } from '../../src/background/store';
import { renderOptions } from '../../src/options/options';

function mapKV(): KV & { m: Map<string, unknown> } {
  const m = new Map<string, unknown>();
  return { m, async get(k) { return m.get(k); }, async set(k, v) { m.set(k, v); } };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

let kv: ReturnType<typeof mapKV>;
let store: Store;
let root: HTMLElement;
let undo: ReturnType<typeof vi.fn<(takenAt: number) => void>>;

async function mount() {
  root = document.createElement('div');
  document.body.replaceChildren(root);
  await renderOptions(root, { store, undo });
}
const field = (name: string) => root.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
async function change(name: string, value: string) {
  const el = field(name);
  el.value = value;
  el.dispatchEvent(new Event('change', { bubbles: true }));
  await flush();
}

beforeEach(() => {
  kv = mapKV();
  store = new Store(kv);
  undo = vi.fn<(takenAt: number) => void>();
});

describe('number settings', () => {
  const cases: [string, keyof Awaited<ReturnType<Store['settings']>>, number, string, number][] = [
    ['staleHours', 'staleHours', 24, '48', 48],
    ['gapMinutes', 'gapMinutes', 5, '10', 10],
    ['stalePerHour', 'stalePerHour', 4, '0', 0],
    ['countdownSeconds', 'countdownSeconds', 5, '12', 12],
  ];
  for (const [name, key, def, input, saved] of cases) {
    it(`${name} shows the stored value and saves changes`, async () => {
      await mount();
      expect(field(name).value).toBe(String(def));
      await change(name, input);
      expect((await store.settings())[key]).toBe(saved);
    });
  }

  it('shows the stored value, not the default', async () => {
    await store.saveSettings({ ...(await store.settings()), gapMinutes: 17 });
    await mount();
    expect(field('gapMinutes').value).toBe('17');
  });

  it('replaces an out-of-range entry with the clamped value', async () => {
    await mount();
    await change('countdownSeconds', '999');
    expect(field('countdownSeconds').value).toBe('30');
    expect((await store.settings()).countdownSeconds).toBe(30);
    await change('staleHours', '0');
    expect(field('staleHours').value).toBe('1');
  });

  it('puts the default back for a blank entry', async () => {
    await mount();
    await change('gapMinutes', '');
    expect(field('gapMinutes').value).toBe('5');
  });
});

describe('site lists', () => {
  const lists = [['distracting', 'Distracting sites'], ['neverTake', 'Never take']] as const;
  for (const [key, label] of lists) {
    const sec = () => root.querySelector<HTMLElement>(`[data-list="${key}"]`)!;
    const add = async (v: string) => {
      const input = sec().querySelector<HTMLInputElement>('input[type="text"]')!;
      input.value = v;
      sec().querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await flush();
    };

    it(`${label}: adds a pasted URL as its site`, async () => {
      await mount();
      await add('https://www.Reddit.com/r/x');
      expect((await store.settings())[key]).toContain('reddit.com');
      expect(sec().textContent).toContain('reddit.com');
    });

    it(`${label}: accepts a bare host and ignores duplicates`, async () => {
      await mount();
      await add('Example.org');
      await add('https://example.org/a');
      expect((await store.settings())[key].filter((s) => s === 'example.org')).toHaveLength(1);
    });

    it(`${label}: rejects nonsense with an error and stores nothing`, async () => {
      await mount();
      const before = (await store.settings())[key];
      await add('not a site at all');
      expect((await store.settings())[key]).toEqual(before);
      expect(sec().querySelector('[role="alert"]')!.textContent).toBe("That doesn't look like a website.");
    });

    it(`${label}: removes a site`, async () => {
      await store.saveSettings({ ...(await store.settings()), [key]: ['a.com', 'b.com'] });
      await mount();
      sec().querySelector<HTMLButtonElement>('button[data-site="a.com"]')!.click();
      await flush();
      expect((await store.settings())[key]).toEqual(['b.com']);
      expect(sec().textContent).not.toContain('a.com');
    });
  }
});

describe('taken list', () => {
  it('says so when empty', async () => {
    await mount();
    expect(root.textContent).toContain("Pockets hasn't taken anything yet.");
  });

  it('lists title, site, reason and time with a reopen button per row', async () => {
    await store.addTaken({ title: 'Cat videos', url: 'https://www.youtube.com/watch?v=1', takenAt: 1_700_000_000_000, reason: 'distracting' });
    await store.addTaken({ title: 'Old docs', url: 'https://docs.example.com/x', takenAt: 1_700_000_100_000, reason: 'stale' });
    await mount();
    const rows = root.querySelectorAll<HTMLElement>('[data-taken]');
    expect(rows).toHaveLength(2);
    const text = Array.from(rows).map((r) => r.textContent ?? '');
    const first = text.find((t) => t.includes('Cat videos'))!;
    expect(first).toContain('youtube.com');
    expect(first.toLowerCase()).toContain('distracting');
    expect(first).toContain(new Date(1_700_000_000_000).toLocaleString());
    expect(text.find((t) => t.includes('Old docs'))!.toLowerCase()).toContain('stale');
    expect(root.querySelectorAll('[data-taken] button')).toHaveLength(2);
  });

  it('shows newest first and calls undo with takenAt on reopen', async () => {
    await store.addTaken({ title: 'A', url: 'https://a.com/', takenAt: 100, reason: 'stale' });
    await store.addTaken({ title: 'B', url: 'https://b.com/', takenAt: 200, reason: 'stale' });
    await mount();
    const rows = root.querySelectorAll<HTMLElement>('[data-taken]');
    expect(rows[0].textContent).toContain('B');
    rows[1].querySelector('button')!.click();
    expect(undo).toHaveBeenCalledWith(100);
  });
});
