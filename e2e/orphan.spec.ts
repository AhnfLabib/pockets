// An orphaned content script: its extension context died (the extension was reloaded or updated while the tab stayed
// open) but its DOM listeners, timers and stage are still in the page. It must shut itself down on its next chance,
// put back the tab title and icon it marked, and never put an error on the console (the owner's bug report:
// "Unsafe attempt to load URL chrome-extension://…/sprites.json" from such an orphan).
//
// A real reload would also kill the `worker` fixture, and the update re-injection could replace the old instance in the
// same isolated world, which proves nothing about a true orphan. So the test build's content script also reads
// `globalThis.__pocketsTestOrphan` in its liveness probe (src/content/index.ts, test builds only), and the test sets it
// in the content script's isolated world with chrome.scripting.executeScript. That simulates the dead context; the real
// invalidation is not exercised here.
//
// Needs a test build: `POCKETS_TEST=1 npm run build`.
import type { Page, Worker } from '@playwright/test';
import { test, expect, type TestServer } from './fixtures';

const FAVICON = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function serve(server: TestServer, path: string): string {
  server.route(path, (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html><head><title>Orphan page</title><link rel="icon" href="${FAVICON}"></head>` +
      `<body><input id="t" style="margin:200px"></body></html>`);
  });
  return server.origin + path;
}

/** Console errors and uncaught errors from the page, its isolated worlds included (checked by the control step). */
function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`console.${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e}`));
  return errors;
}

const tabIdFor = (worker: Worker, url: string) =>
  worker.evaluate(async (u) => (await chrome.tabs.query({})).find((t) => t.url === u)?.id ?? -1, url);

/** Send a message to the tab's top frame from the worker; the reply, or `{ error }` if nothing answered. */
const toTab = (worker: Worker, tabId: number, msg: unknown) =>
  worker.evaluate(async ([id, m]) => {
    try {
      return (await chrome.tabs.sendMessage(id as number, m, { frameId: 0 })) ?? null;
    } catch (e) {
      return { error: String(e) };
    }
  }, [tabId, msg] as const) as Promise<any>;

async function contentReady(worker: Worker, tabId: number): Promise<void> {
  await expect.poll(async () => (await toTab(worker, tabId, { type: 'pockets/ping' }))?.from ?? null, { timeout: 10_000, intervals: [100] })
    .toBe('content');
}

/** In the content scripts' isolated world of the tab's top frame: orphan the instance (test builds read this flag in
 *  the liveness probe), or log a control error. */
const inIsolatedWorld = (worker: Worker, tabId: number, what: 'orphan' | 'control') =>
  worker.evaluate(async ([id, w]) => {
    await chrome.scripting.executeScript({
      target: { tabId: id as number },
      func: w === 'orphan'
        ? () => { (globalThis as Record<string, unknown>).__pocketsTestOrphan = true; }
        : () => { console.error('pockets control'); },
    });
  }, [tabId, what] as const);

/** The mark icon as the background would send it on pockets/mark. */
const markIcon = (worker: Worker) =>
  worker.evaluate(async () => {
    const b = new Uint8Array(await (await fetch(chrome.runtime.getURL('assets/icons/icon-32.png'))).arrayBuffer());
    let s = '';
    for (const x of b) s += String.fromCharCode(x);
    return 'data:image/png;base64,' + btoa(s);
  });

const iconHrefs = (page: Page) => page.evaluate(() => Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')).map((l) => l.getAttribute('href')));

async function markedPageWithStage(page: Page, worker: Worker, server: TestServer, path: string) {
  const url = serve(server, path);
  await page.goto(url);
  const tabId = await tabIdFor(worker, url);
  await contentReady(worker, tabId);
  // The notice mounts the stage: the sprites and the notice icon now come from the background by message
  // (no web_accessible_resources), so ok:true here means that path works.
  expect(await toTab(worker, tabId, { type: 'pockets/notice', title: 'Some tab', takenAt: 1 })).toEqual({ ok: true });
  await expect.poll(() => page.evaluate(() => document.querySelectorAll('pockets-stage').length)).toBe(1);
  expect(await toTab(worker, tabId, { type: 'pockets/mark', remaining: 3, icon: await markIcon(worker) })).toEqual({ ok: true });
  expect(await page.title()).toBe('Mine in 3…');
  const hrefs = await iconHrefs(page);
  expect(hrefs.length).toBe(1);
  expect(hrefs[0]).toMatch(/^data:image\/png;base64,/);
  expect(hrefs[0]).not.toBe(FAVICON);
  return tabId;
}

test('orphan: typing in a page whose content script lost its extension context disposes it, restores the tab, and logs nothing', async ({ context, worker, server }) => {
  const page = context.pages()[0] ?? (await context.newPage());
  const errors = collectErrors(page);
  const tabId = await markedPageWithStage(page, worker, server, '/orphan-typing');

  // Control: the collector does see output from the content scripts' isolated world.
  await inIsolatedWorld(worker, tabId, 'control');
  await expect.poll(() => errors.some((e) => e.includes('pockets control'))).toBe(true);
  errors.length = 0;

  await inIsolatedWorld(worker, tabId, 'orphan');
  await page.click('#t');
  await page.keyboard.type('hello');

  // The orphan disposed itself on the input event: its stage is gone, the page's own title and icon are back.
  await expect.poll(() => page.evaluate(() => document.querySelectorAll('pockets-stage').length)).toBe(0);
  expect(await page.title()).toBe('Orphan page');
  expect(await iconHrefs(page)).toEqual([FAVICON]);
  // It reported nothing: the tab is not counted as typed in, and nothing answers in the page any more.
  const rt = await worker.evaluate(async () => (await chrome.storage.local.get('runtime')).runtime ?? null) as { typedIn?: number[] } | null;
  expect(rt?.typedIn ?? []).not.toContain(tabId);
  expect((await toTab(worker, tabId, { type: 'pockets/ping' }))?.from).toBeUndefined();

  // Later events find nothing left to run.
  await page.evaluate(() => {
    window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
    window.dispatchEvent(Object.assign(new Event('pagehide'), { persisted: true }));
    document.title = 'Page changed its title';
  });
  await page.keyboard.type(' again');
  await page.waitForTimeout(1000);
  expect(await page.title()).toBe('Page changed its title');
  expect(errors).toEqual([]);
});

test('orphan: an idle marked tab with no events puts its own title and icon back by itself', async ({ context, worker, server }) => {
  const page = context.pages()[0] ?? (await context.newPage());
  const errors = collectErrors(page);
  await markedPageWithStage(page, worker, server, '/orphan-idle').then((tabId) => inIsolatedWorld(worker, tabId, 'orphan'));
  // No input, no navigation: the instance's own periodic check (every 5 s while marked) finds the context dead.
  await expect.poll(() => page.title(), { timeout: 12_000, intervals: [250] }).toBe('Orphan page');
  expect(await iconHrefs(page)).toEqual([FAVICON]);
  await expect.poll(() => page.evaluate(() => document.querySelectorAll('pockets-stage').length)).toBe(0);
  expect(errors).toEqual([]);
});

test('strict page CSP: the stage mounts from the background-served data URLs and the tab is marked', async ({ context, worker, server }) => {
  server.route('/csp-strict', (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'none'" });
    res.end(`<!doctype html><html><head><title>Strict page</title></head><body><input id="t"></body></html>`);
  });
  const url = server.origin + '/csp-strict';
  const page = context.pages()[0] ?? (await context.newPage());
  const errors = collectErrors(page);
  await page.goto(url);
  const tabId = await tabIdFor(worker, url);
  await contentReady(worker, tabId);
  // The sprite sheets and the notice icon are decoded in the content script's isolated world: the page CSP does not
  // stop them, so the stage mounts and nothing is logged.
  expect(await toTab(worker, tabId, { type: 'pockets/notice', title: 'Some tab', takenAt: 1 })).toEqual({ ok: true });
  await expect.poll(() => page.evaluate(() => document.querySelectorAll('pockets-stage').length)).toBe(1);
  await page.waitForTimeout(500);
  expect(errors, 'mounting the stage logs nothing under a strict CSP').toEqual([]);

  // The tab icon is a <link rel=icon> the browser loads for the page, so the page's CSP applies to it. With img-src
  // closed (here via default-src 'none') the data: icon is refused and the browser logs a CSP violation: the mark is
  // then title-only. Recorded, not hidden: the old chrome-extension:// icon bypassed page CSP but needed
  // web_accessible_resources, which is gone.
  const icon = await markIcon(worker);
  expect(await toTab(worker, tabId, { type: 'pockets/mark', remaining: 3, icon })).toEqual({ ok: true });
  expect(await page.title()).toBe('Mine in 3…');
  await page.waitForTimeout(1500);
  const fav = await worker.evaluate(async (id) => (await chrome.tabs.get(id)).favIconUrl ?? '', tabId);
  test.info().annotations.push({ type: 'finding', description: `strict CSP: favIconUrl ${fav === icon ? 'is the mark icon' : `"${fav.slice(0, 40)}"`}; ` +
    `logged: ${errors.map((e) => e.slice(0, 120)).join(' | ') || 'nothing'}` });
  expect(fav, 'the CSP refuses the data: tab icon (recorded behaviour)').not.toBe(icon);
  expect(errors.filter((e) => !/Loading the image 'data:image\/png;base64,.*Content Security Policy directive/s.test(e)), 'nothing logged but the refused icon')
    .toEqual([]);
});
