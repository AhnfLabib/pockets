// The character page (dist/harness/character.html), opened as a file the way the owner will open it.
// It plays a whole visit with the real stage mounted on an iframe's document.
import { test, expect, type Page } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const PAGE = pathToFileURL(resolve(process.cwd(), 'dist/harness/character.html')).href;

interface Snapshot { events: string[]; card: { left: number; top: number; width: number; height: number } | null }

async function open(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.goto(PAGE);
  await page.waitForFunction(() => (window as any).__pockets?.ready === true);
  return errors;
}

const snapshot = (page: Page): Promise<Snapshot> =>
  page.evaluate(() => {
    const s = (window as any).__pockets;
    return { events: s.events.slice(), card: s.cardAtShown };
  });

async function waitForEvent(page: Page, name: string, timeout = 45_000): Promise<void> {
  await page.waitForFunction((n) => (window as any).__pockets.events.includes(n), name, { timeout });
}

/** Non-transparent pixels on the stage canvas (read in-page; the sheets are data URLs, so it is untainted). */
const inkedPixels = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const root: ShadowRoot = (window as any).__pockets.root;
    const cv = root.querySelector('canvas') as HTMLCanvasElement;
    const data = cv.getContext('2d')!.getImageData(0, 0, cv.width, cv.height).data;
    let n = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) n++;
    return n;
  });

test('take ending: climbs, warns with the card on screen, takes the tab and runs to done', async ({ page }) => {
  const errors = await open(page);
  await page.click('#play');
  await page.waitForTimeout(3000); // past the peek and the look, on the border
  expect(await inkedPixels(page)).toBeGreaterThan(500);

  await waitForEvent(page, 'card-shown');
  const frame = await page.locator('#page').boundingBox();
  const { card } = await snapshot(page);
  // card-shown means the card is laid out and inside the stage's viewport.
  expect(card).not.toBeNull();
  expect(card!.width).toBeGreaterThan(100);
  expect(card!.height).toBeGreaterThan(40);
  expect(card!.left).toBeGreaterThanOrEqual(0);
  expect(card!.top).toBeGreaterThanOrEqual(0);
  expect(card!.left + card!.width).toBeLessThanOrEqual(frame!.width);
  expect(card!.top + card!.height).toBeLessThanOrEqual(frame!.height);
  await expect(page.locator('#target span')).toHaveText(/Mine in \d…/);

  await waitForEvent(page, 'done');
  const { events } = await snapshot(page);
  expect(events).toEqual(['card-shown', 'tick 5', 'tick 4', 'tick 3', 'tick 2', 'tick 1', 'take', 'done']);
  await expect(page.locator('#target')).toHaveCount(0);
  // Pockets has gone and the canvas is clear again.
  expect(await inkedPixels(page)).toBe(0);
  expect(errors).toEqual([]);
});

test('keep ending: pressing Keep yields keep and done, never take', async ({ page }) => {
  const errors = await open(page);
  await page.click('#playKeep');
  await waitForEvent(page, 'done');
  const { events } = await snapshot(page);
  expect(events).toEqual(['card-shown', 'tick 5', 'tick 4', 'tick 3', 'keep', 'done']);
  await expect(page.locator('#target span')).toHaveText('YouTube');
  expect(errors).toEqual([]);
});

test('reduced motion: the card sits top-left with Pockets drawn still beside it', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors = await open(page);
  await page.click('#play');
  await waitForEvent(page, 'card-shown', 5_000);
  const { card } = await snapshot(page);
  expect(card!.left).toBeLessThanOrEqual(16);
  expect(card!.top).toBeLessThanOrEqual(16);
  const a = await inkedPixels(page);
  expect(a).toBeGreaterThan(500);
  await page.waitForTimeout(700);
  // Still: the same drawing a moment later.
  expect(await inkedPixels(page)).toBe(a);
  await waitForEvent(page, 'done', 15_000);
  expect(errors).toEqual([]);
});

test('stage isolation: closed root, pointer passes through, nothing takes focus', async ({ page }) => {
  await open(page);
  await page.click('#play');
  await waitForEvent(page, 'card-shown');
  const info = await page.evaluate(() => {
    const doc = (document.getElementById('page') as HTMLIFrameElement).contentDocument!;
    const host = doc.querySelector('pockets-stage') as HTMLElement;
    const cs = doc.defaultView!.getComputedStyle(host);
    const root: ShadowRoot = (window as any).__pockets.root;
    const focusable = [...root.querySelectorAll('*')].filter((el) => (el as HTMLElement).tabIndex >= 0 && !(el as HTMLElement).closest('[hidden]'));
    const r = doc.defaultView!;
    return {
      shadowRoot: host.shadowRoot === null,
      mode: root.mode,
      position: cs.position,
      zIndex: cs.zIndex,
      pointer: cs.pointerEvents,
      hit: doc.elementFromPoint(r.innerWidth / 2, r.innerHeight - 20)?.tagName,
      active: doc.activeElement?.tagName,
      focusable: focusable.map((el) => el.className),
    };
  });
  expect(info.shadowRoot).toBe(true);
  expect(info.mode).toBe('closed');
  expect(info.position).toBe('fixed');
  expect(info.zIndex).toBe('2147483647');
  expect(info.pointer).toBe('none');
  expect(info.hit).not.toBe('POCKETS-STAGE');
  expect(info.active).toBe('BODY');
  expect(info.focusable).toEqual(['keep']);
  await page.evaluate(() => (window as any).__pockets.stage.cancel());
});
