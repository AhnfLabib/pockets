// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Store, type KV } from '../../src/background/store';
import { renderPopup } from '../../src/popup/popup';

function mapKV(): KV & { m: Map<string, unknown> } {
  const m = new Map<string, unknown>();
  return { m, async get(k) { return m.get(k); }, async set(k, v) { m.set(k, v); } };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

let kv: ReturnType<typeof mapKV>;
let store: Store;
let root: HTMLElement;
let setWorking: ReturnType<typeof vi.fn<(on: boolean) => Promise<void>>>;
let undo: ReturnType<typeof vi.fn<(takenAt: number) => void>>;
let openOptions: ReturnType<typeof vi.fn<() => void>>;

async function mount(currentUrl: string | null = 'https://news.example.com/a') {
  root = document.createElement('div');
  document.body.replaceChildren(root);
  await renderPopup(root, { store, currentUrl, now: () => 1_000_000, setWorking, undo, openOptions });
}
const sw = () => root.querySelector<HTMLInputElement>('input[role="switch"]')!;
const addBtn = () => root.querySelector<HTMLButtonElement>('button.add-site')!;
const items = () => [...root.querySelectorAll<HTMLElement>('li[data-taken]')];

beforeEach(() => {
  kv = mapKV();
  store = new Store(kv);
  setWorking = vi.fn(async () => {});
  undo = vi.fn();
  openOptions = vi.fn();
});

describe('working switch', () => {
  it('reflects runtime state and label', async () => {
    await store.saveRuntime({ ...(await store.runtime()), working: true });
    await mount();
    expect(sw().checked).toBe(true);
    expect(root.textContent).toContain('Working');
    expect(root.textContent).not.toContain('Not working');
  });
  it('reads Not working when off', async () => {
    await mount();
    expect(sw().checked).toBe(false);
    expect(root.querySelector('.state')!.textContent).toBe('Not working');
  });
  it('toggling asks the background and updates the label, without writing runtime itself', async () => {
    await mount();
    const before = JSON.stringify(kv.m.get('runtime'));
    sw().checked = true;
    sw().dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(setWorking).toHaveBeenCalledWith(true);
    expect(root.querySelector('.state')!.textContent).toBe('Working');
    expect(JSON.stringify(kv.m.get('runtime'))).toBe(before);
  });
});

describe('switch failure and name', () => {
  it('has a fixed accessible name', async () => {
    await mount();
    expect(sw().getAttribute('aria-label')).toBe('Working mode');
  });
  it('reverts to the stored state when the background refuses', async () => {
    setWorking.mockRejectedValueOnce(new Error('nope'));
    await mount();
    sw().checked = true;
    sw().dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(sw().checked).toBe(false);
    expect(root.querySelector('.state')!.textContent).toBe('Not working');
    expect(sw().disabled).toBe(false);
  });
});

describe('add this site', () => {
  it('appends the site and reads Added', async () => {
    await mount();
    expect(addBtn().textContent).toBe('Add this site');
    addBtn().click();
    await flush();
    expect((await store.settings()).distracting).toContain('news.example.com');
    expect(addBtn().textContent).toBe('Added');
    expect(addBtn().disabled).toBe(true);
  });
  it('is disabled when the url has no site', async () => {
    await mount('chrome://extensions');
    expect(addBtn().disabled).toBe(true);
    await mount(null);
    expect(addBtn().disabled).toBe(true);
  });
  it('is disabled and reads Added when already listed', async () => {
    await store.saveSettings({ ...(await store.settings()), distracting: ['news.example.com'] });
    await mount();
    expect(addBtn().disabled).toBe(true);
    expect(addBtn().textContent).toBe('Added');
  });
  it('does not duplicate on a second click', async () => {
    await mount();
    addBtn().click();
    addBtn().click();
    await flush();
    expect((await store.settings()).distracting.filter((s) => s === 'news.example.com')).toHaveLength(1);
  });
});

describe('taken tabs', () => {
  it('lists the five newest first with reopen buttons', async () => {
    for (let i = 1; i <= 7; i++) await store.addTaken({ title: `T${i}`, url: `https://s${i}.com/`, takenAt: i * 1000, reason: 'stale' });
    await mount();
    expect(items().map((li) => li.querySelector('.title')!.textContent)).toEqual(['T7', 'T6', 'T5', 'T4', 'T3']);
    items()[1].querySelector('button')!.click();
    expect(undo).toHaveBeenCalledWith(6000);
  });
  it('shows titles as text, never markup', async () => {
    await store.addTaken({ title: '<img src=x onerror=alert(1)>', url: 'https://x.com/', takenAt: 1, reason: 'distracting' });
    await mount();
    expect(root.querySelector('img')).toBeNull();
    expect(items()[0].querySelector('.title')!.textContent).toBe('<img src=x onerror=alert(1)>');
  });
  it('says so when nothing was taken', async () => {
    await mount();
    expect(root.textContent).toContain("Pockets hasn't taken anything yet.");
    expect(items()).toHaveLength(0);
  });
});

describe('settings link', () => {
  it('opens the options page', async () => {
    await mount();
    root.querySelector<HTMLAnchorElement>('a.settings')!.click();
    expect(openOptions).toHaveBeenCalled();
  });
});
