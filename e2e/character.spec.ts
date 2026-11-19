// The character page (dist-harness/character.html), opened as a file the way the owner will open it.
// It plays a whole visit with the real stage mounted on an iframe's document.
import { test, expect, type Page } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const PAGE = pathToFileURL(resolve(process.cwd(), 'dist-harness/character.html')).href;

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
    // alive is the stage's keep-awake ping during a long climb; these specs check the visible choreography.
    return { events: s.events.filter((e: string) => e !== 'alive'), card: s.cardAtShown };
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

/** Start a visit straight on the stage with requestAnimationFrame stubbed to never call back (as in a hidden
 *  tab), cancel it, and report whether play() settled and what was emitted. */
async function cancelWithoutFrames(page: Page): Promise<{ settled: boolean; events: string[] }> {
  return page.evaluate(async () => {
    const win = (document.getElementById('page') as HTMLIFrameElement).contentWindow!;
    win.requestAnimationFrame = () => 0;
    const stage = (window as any).__pockets.stage;
    const events: string[] = [];
    let settled = false;
    const plan = { visitId: 'nf', targetTabId: 2, title: 'YouTube', reason: 'stale', reasonText: 'not opened for 2 days',
      tabIndex: 2, tabCount: 5, countdownSeconds: 5, targetIsStage: false };
    const p = stage.play(plan, (e: { type: string }) => events.push(e.type)).then(() => { settled = true; });
    await new Promise((r) => setTimeout(r, 500));
    const before = settled;
    stage.cancel();
    await Promise.race([p, new Promise((r) => setTimeout(r, 1000))]);
    return { settled: !before && settled, events };
  });
}

test('cancel with no animation frames (hidden tab) while the card waits to show: play resolves, nothing emitted', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); // no crawl: play goes straight to the card's show()
  const errors = await open(page);
  expect(await cancelWithoutFrames(page)).toEqual({ settled: true, events: [] });
  expect(errors).toEqual([]);
});

test('cancel with no animation frames (hidden tab) mid-climb: play resolves, nothing emitted', async ({ page }) => {
  const errors = await open(page);
  expect(await cancelWithoutFrames(page)).toEqual({ settled: true, events: [] });
  expect(errors).toEqual([]);
});

test('every quote fits the bubble in at most two lines at the rendered font', async ({ page }) => {
  const { QUOTES, BUBBLE_LINE_PX, BUBBLE_MAX_WIDTH, BUBBLE_CHAR_PX } = await import('../src/stage/quotes');
  await open(page);
  const lines = [...QUOTES.general, ...QUOTES.distracting, ...QUOTES.riffs];
  const sizes = await page.evaluate((all) => {
    const root: ShadowRoot = (window as any).__pockets.root;
    const wrap = root.querySelector('.wrap')!;
    const b = root.ownerDocument.createElement('div');
    b.className = 'bubble down east';
    wrap.appendChild(b);
    const out = all.map((text: string) => {
      b.textContent = text;
      const cs = getComputedStyle(b);
      const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
      const lines = Math.round((b.offsetHeight - pad) / parseFloat(cs.lineHeight));
      const width = b.offsetWidth;
      b.style.whiteSpace = 'nowrap';
      b.style.maxWidth = 'none';
      const range = root.ownerDocument.createRange();
      range.selectNodeContents(b);
      const textPx = range.getBoundingClientRect().width;
      b.style.whiteSpace = '';
      b.style.maxWidth = '';
      return { text, lines, width, pe: cs.pointerEvents, perChar: textPx / text.length };
    });
    b.remove();
    return out;
  }, lines);
  for (const s of sizes) {
    expect(s.lines, s.text).toBeLessThanOrEqual(2);
    expect(s.width, s.text).toBeLessThanOrEqual(BUBBLE_MAX_WIDTH);
    expect(s.pe).toBe('none');
    // The unit test's character budget must be at least the real average advance of each line.
    expect(s.perChar, s.text).toBeLessThanOrEqual(BUBBLE_CHAR_PX);
  }
  expect(BUBBLE_LINE_PX).toBeGreaterThan(0);
});

/** A seed whose visit says something (the planner is pure, so the e2e picks it the same way the stage will). */
async function quoteSeed(): Promise<number> {
  const { planChoreography } = await import('../src/stage/sequence');
  const mulberry = (seed: number) => {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
    };
  };
  for (let s = 1; ; s++) if (planChoreography(mulberry(s), { reduced: false, reason: 'stale' }).quote) return s;
}

test('quote bubble: shown by Pockets on entry, ignores the pointer, gone before the card', async ({ page }) => {
  const errors = await open(page);
  const seed = await quoteSeed();
  await page.evaluate((s) => { (window as any).__pockets.nextSeed = s; }, seed);
  await page.click('#play');
  // The first frame it is painted (polled every animation frame) must already be where it stays while Pockets looks
  // around: never a flash at a stale or default position.
  const bubble = await page.waitForFunction(() => {
    const b = (window as any).__pockets.root.querySelector('.bubble') as HTMLElement;
    if (b.hidden || getComputedStyle(b).visibility !== 'visible') return null;
    const r = b.getBoundingClientRect();
    return { text: b.textContent, pe: getComputedStyle(b).pointerEvents, tab: b.tabIndex, aria: b.getAttribute('aria-hidden'), r: { l: r.left, t: r.top, w: r.width, h: r.height } };
  }, null, { timeout: 10_000, polling: 'raf' }).then((h) => h.jsonValue());
  await page.waitForTimeout(300);
  const later = await page.evaluate(() => {
    const r = ((window as any).__pockets.root.querySelector('.bubble') as HTMLElement).getBoundingClientRect();
    return { l: r.left, t: r.top, w: r.width, h: r.height };
  });
  // Centre, not corner: the pop's scale moves the corner by up to 5% of the size.
  expect(Math.abs(later.l + later.w / 2 - (bubble!.r.l + bubble!.r.w / 2))).toBeLessThan(6);
  expect(Math.abs(later.t + later.h / 2 - (bubble!.r.t + bubble!.r.h / 2))).toBeLessThan(6);
  expect(bubble!.r.w).toBeGreaterThanOrEqual(later.w * 0.88); // the pop scales in from 0.9
  expect(bubble!.text!.length).toBeGreaterThan(0);
  expect(bubble!.pe).toBe('none');
  expect(bubble!.aria).toBe('true');
  expect(bubble!.tab).toBe(-1);
  const frame = await page.locator('#page').boundingBox();
  expect(bubble!.r.l).toBeGreaterThanOrEqual(0);
  expect(bubble!.r.t).toBeGreaterThanOrEqual(0);
  expect(bubble!.r.l + bubble!.r.w).toBeLessThanOrEqual(frame!.width);
  expect(bubble!.r.t + bubble!.r.h).toBeLessThanOrEqual(frame!.height);
  await waitForEvent(page, 'card-shown');
  expect(await page.evaluate(() => ((window as any).__pockets.root.querySelector('.bubble') as HTMLElement).hidden)).toBe(true);
  await waitForEvent(page, 'done');
  expect(errors).toEqual([]);
});
