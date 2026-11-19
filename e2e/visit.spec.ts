// Task 15: whole visits in real Chromium, with the real extension, content script and stage.
//
// Needs a test build: `POCKETS_TEST=1 npm run build`. The test-only hook (`pockets/test-set`, also reachable from
// code evaluated in the service worker as globalThis.__pocketsTestSet) shrinks the timings, resets pacing and runs a
// tick at once. Everything else is the product path: the visit machine picks the target, the stage plays on the
// active page, the card reports card-shown, the background closes the tab, the notice offers Undo.
//
// The card's "Keep this tab" and the notice's "Undo" live in a closed shadow root, so they are clicked with the real
// mouse at their on-screen position, computed from the stage's own layout (sequence.ts cardPosition, card.ts CSS).
//
// Rules from Task 1 (docs/verification.md): never discard a tab here; Playwright keeps attached pages "visible".
// Local pages are served on 127.0.0.1. `distracting.test` is mapped to 127.0.0.1 with --host-resolver-rules so it can
// sit on the distracting list without making every local page distracting. The iframes load from `localhost`, so they
// are cross-origin to their 127.0.0.1 parent.
import type { BrowserContext, Page, Worker } from '@playwright/test';
import { test as base, expect, launchExtensionContext, type TestServer } from './fixtures';
import { cardPosition, estimateTabX, CARD_WIDTH } from '../src/stage/sequence';

const test = base.extend<{ context: BrowserContext }>({
  context: async ({ userDataDir }, use) => {
    const context = await launchExtensionContext(userDataDir, ['--host-resolver-rules=MAP distracting.test 127.0.0.1']);
    await use(context);
    await context.close().catch(() => {});
  },
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- what the hook and the worker can tell us ----

interface TestSet {
  settings?: Record<string, unknown>;
  runtime?: { lastStaleVisitEnd?: number; lastDistractingTake?: number; staleTakes?: number[] };
  tick?: boolean;
  inject?: boolean;
}
interface Visit { visitId: string; targetTabId: number; targetUrl: string; stageTabId: number; reason: string; cardShown: boolean }
interface Runtime { working: boolean; typedIn: number[]; spared: Record<string, { until?: number }>; visit: Visit | null }
interface Taken { title: string; url: string; takenAt: number; reason: string; sessionId?: string; noticeTabId?: number }
interface Tab { id: number; index: number; url: string; title: string; active: boolean; lastAccessed: number }

/** Call the hook from inside the service worker (the test's own evaluation; never reachable from a web page). */
const testSet = (worker: Worker, p: TestSet) =>
  worker.evaluate((arg) => {
    const hook = (globalThis as any).__pocketsTestSet;
    if (typeof hook !== 'function') throw new Error('no test hook: build with `POCKETS_TEST=1 npm run build` first');
    return hook(arg);
  }, p) as Promise<{ ok: boolean; injected?: number[] }>;

const runtime = (worker: Worker) =>
  worker.evaluate(async () => (await chrome.storage.local.get('runtime')).runtime ?? null) as Promise<Runtime | null>;

const taken = (worker: Worker) =>
  worker.evaluate(async () => (await chrome.storage.local.get('taken')).taken ?? []) as Promise<Taken[]>;

const tabs = (worker: Worker) =>
  worker.evaluate(async () =>
    (await chrome.tabs.query({})).map((t) => ({
      id: t.id!, index: t.index, url: t.url ?? '', title: t.title ?? '', active: t.active, lastAccessed: t.lastAccessed ?? 0,
    }))) as Promise<Tab[]>;

async function tabFor(worker: Worker, url: string): Promise<Tab> {
  const t = (await tabs(worker)).find((x) => x.url === url);
  if (!t) throw new Error('no tab for ' + url);
  return t;
}

/** Wait until the tab's top-frame content script answers, so a visit is not raced against page load. */
async function contentReady(worker: Worker, tabId: number): Promise<void> {
  const ok = await worker.evaluate(async (id) => {
    for (let i = 0; i < 100; i++) {
      try {
        const r = await chrome.tabs.sendMessage(id, { type: 'pockets/ping' }, { frameId: 0 });
        if (r?.from === 'content') return true;
      } catch { /* not yet */ }
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  }, tabId);
  expect(ok, `content script ready in tab ${tabId}`).toBe(true);
}

async function waitVisit(worker: Worker, pred: (v: Visit) => boolean, what: string, timeout = 45_000): Promise<Visit> {
  let found: Visit | null = null;
  await expect.poll(async () => {
    const v = (await runtime(worker))?.visit ?? null;
    if (v && pred(v)) found = v;
    return found !== null;
  }, { message: what, timeout, intervals: [100] }).toBe(true);
  return found!;
}

const tabGone = (worker: Worker, id: number, timeout = 30_000) =>
  expect.poll(async () => (await tabs(worker)).some((t) => t.id === id), { message: `tab ${id} closed`, timeout, intervals: [100] }).toBe(false);

// ---- pages ----

function page(title: string, body = ''): string {
  return `<!doctype html><html><head><title>${title}</title></head><body style="margin:0;background:#fff">` +
    `<h1 style="font:16px sans-serif;margin:200px 0 0 400px">${title}</h1>${body}</body></html>`;
}

function serve(server: TestServer, path: string, html: string): string {
  server.route(path, (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  return server.origin + path;
}

/** The same server under another host, so a frame from it is cross-origin to a 127.0.0.1 page. */
const otherOrigin = (server: TestServer) => server.origin.replace('127.0.0.1', 'localhost');
const distractingOrigin = (server: TestServer) => server.origin.replace('127.0.0.1', 'distracting.test');

async function open(context: BrowserContext, url: string, reuse?: Page): Promise<Page> {
  const p = reuse ?? (await context.newPage());
  await p.goto(url);
  await p.bringToFront();
  return p;
}

/**
 * Three tabs, oldest first: the target (reusing the context's first page, so no stray about:blank tab is left to be
 * a candidate), another page, then the stage in front. The target is the least recently used, so it is the stale pick.
 */
async function threeTabs(context: BrowserContext, worker: Worker, urls: { target: string; other: string; stage: string }) {
  const targetPage = await open(context, urls.target, context.pages()[0]);
  await sleep(150);
  const otherPage = await open(context, urls.other);
  await sleep(150);
  const stagePage = await open(context, urls.stage);
  const target = await tabFor(worker, urls.target);
  const other = await tabFor(worker, urls.other);
  const stage = await tabFor(worker, urls.stage);
  for (const t of [target, other, stage]) await contentReady(worker, t.id);
  return { targetPage, otherPage, stagePage, target, other, stage };
}

/** Settings for a quick stale visit. A long gap keeps a second visit from following the first on its own. */
const QUICK_STALE = { staleHours: 0.0002 /* 0.72 s */, gapMinutes: 60, stalePerHour: 4, countdownSeconds: 3 };

/** Check the preconditions a stale tick depends on, so a failure reads as setup, not product. */
async function expectStaleSetup(worker: Worker, targetId: number, stageId: number): Promise<void> {
  await sleep(900); // every background tab is now older than 0.72 s
  const all = await tabs(worker);
  expect(all.find((t) => t.active)?.id, 'the stage is the active tab').toBe(stageId);
  const background = all.filter((t) => !t.active).sort((a, b) => a.lastAccessed - b.lastAccessed);
  expect(background[0]?.id, 'the target is the least recently used tab').toBe(targetId);
}

/** Viewport point of the card's Keep button. The card is 250 px wide at cardPosition(); Keep is its full-width last row,
 *  centred about 78 px below the card's top when the line under the title fits on one line, which the short titles
 *  used here guarantee (checked against a screenshot: the button spans top + 63 to top + 94). */
async function keepPoint(stagePage: Page, tabIndex: number, tabCount: number): Promise<{ x: number; y: number }> {
  const width = await stagePage.evaluate(() => innerWidth);
  const at = cardPosition(estimateTabX(tabIndex, tabCount, width), width, false);
  return { x: at.left + Math.min(CARD_WIDTH, width - 24) / 2, y: at.top + 78 };
}

/** Viewport point of the notice's Undo button: the notice is 12 px from the bottom right, Undo is its last item. */
async function undoPoint(stagePage: Page): Promise<{ x: number; y: number }> {
  const { w, h } = await stagePage.evaluate(() => ({ w: innerWidth, h: innerHeight }));
  return { x: w - 50, y: h - 37 };
}

async function shot(p: Page, name: string): Promise<void> {
  await p.screenshot({ path: test.info().outputPath(`${name}.png`) });
}

// ---- specs ----

test('stale: the card shows on the active page, then the stale tab is taken and the other two stay', async ({ context, worker, server }) => {
  const s = await threeTabs(context, worker, {
    target: serve(server, '/stale-target', page('t1')),
    other: serve(server, '/stale-other', page('other')),
    stage: serve(server, '/stale-stage', page('stage')),
  });
  await expectStaleSetup(worker, s.target.id, s.stage.id);

  expect((await testSet(worker, { settings: QUICK_STALE, tick: true })).ok).toBe(true);
  const v = await waitVisit(worker, (x) => x.targetTabId === s.target.id, 'a stale visit for the target');
  expect(v).toMatchObject({ reason: 'stale', stageTabId: s.stage.id, targetUrl: s.target.url });

  await waitVisit(worker, (x) => x.visitId === v.visitId && x.cardShown, 'card-shown on the stage');
  // The countdown shows on the target's own tab (title swap) while it runs.
  await expect.poll(async () => (await tabFor(worker, s.target.url)).title, { timeout: 5000 }).toMatch(/^Mine in \d…$/);

  await tabGone(worker, s.target.id);
  const left = (await tabs(worker)).map((t) => t.id).sort();
  expect(left).toEqual([s.other.id, s.stage.id].sort());
  await expect.poll(async () => (await taken(worker)).find((t) => t.url === s.target.url)?.noticeTabId).toBe(s.stage.id);
  const entry = (await taken(worker)).find((t) => t.url === s.target.url)!;
  expect(entry).toMatchObject({ title: 't1', reason: 'stale' });
  await expect.poll(async () => (await runtime(worker))?.visit ?? null).toBeNull();
});

test('keep: clicking "Keep this tab" leaves all three open and puts the target title back', async ({ context, worker, server }) => {
  const s = await threeTabs(context, worker, {
    target: serve(server, '/keep-target', page('k1')),
    other: serve(server, '/keep-other', page('other')),
    stage: serve(server, '/keep-stage', page('stage')),
  });
  await expectStaleSetup(worker, s.target.id, s.stage.id);

  await testSet(worker, { settings: QUICK_STALE, tick: true });
  await waitVisit(worker, (x) => x.targetTabId === s.target.id && x.cardShown, 'card-shown for the target');
  await expect.poll(async () => (await tabFor(worker, s.target.url)).title).toMatch(/^Mine in \d…$/);
  await sleep(300); // past the card's 0.2 s pop-in

  const all = await tabs(worker);
  const at = await keepPoint(s.stagePage, s.target.index, all.length);
  await shot(s.stagePage, 'keep-card');
  await s.stagePage.mouse.click(at.x, at.y);

  // Keep ends the visit and spares the tab.
  await expect.poll(async () => (await runtime(worker))?.visit ?? null, { message: 'visit ended by Keep' }).toBeNull();
  expect((await runtime(worker))!.spared[String(s.target.id)], 'target spared').toBeTruthy();
  await expect.poll(async () => (await tabFor(worker, s.target.url)).title).toBe('k1');

  // Well past when the countdown would have ended: nothing was taken.
  await sleep(4000);
  expect((await tabs(worker)).map((t) => t.id).sort()).toEqual([s.target.id, s.other.id, s.stage.id].sort());
  expect(await taken(worker)).toEqual([]);
  expect((await tabFor(worker, s.target.url)).title).toBe('k1');
});

test('undo: clicking Undo on the notice brings the taken tab back', async ({ context, worker, server }) => {
  const s = await threeTabs(context, worker, {
    target: serve(server, '/undo-target', page('u1')),
    other: serve(server, '/undo-other', page('other')),
    stage: serve(server, '/undo-stage', page('stage')),
  });
  await expectStaleSetup(worker, s.target.id, s.stage.id);

  await testSet(worker, { settings: QUICK_STALE, tick: true });
  await waitVisit(worker, (x) => x.targetTabId === s.target.id, 'a stale visit for the target');
  await tabGone(worker, s.target.id);
  // The notice is sent right after the entry records who was shown it; it stays up for about five seconds.
  await expect.poll(async () => (await taken(worker)).find((t) => t.url === s.target.url)?.noticeTabId).toBe(s.stage.id);
  await sleep(400); // past the notice's 0.25 s rise
  await shot(s.stagePage, 'undo-notice');
  const at = await undoPoint(s.stagePage);
  await s.stagePage.mouse.click(at.x, at.y);

  await expect.poll(async () => (await tabs(worker)).some((t) => t.url === s.target.url), { message: 'taken tab is back', timeout: 10_000 }).toBe(true);
  await expect.poll(async () => (await taken(worker)).length, { message: 'the taken entry is gone' }).toBe(0);
  const back = await tabFor(worker, s.target.url);
  expect(back.index, 'restored in its old place').toBe(0);
  expect((await tabs(worker)).length).toBe(3);
});

test('working mode: the active distracting page is taken when working, and not when working is off', async ({ context, worker, server }) => {
  const id = new URL(worker.url()).host;
  const plainUrl = serve(server, '/plain', page('plain'));
  await open(context, plainUrl, context.pages()[0]);
  const funUrl = distractingOrigin(server) + '/fun';
  const fun = await open(context, funUrl);
  const funTab = await tabFor(worker, funUrl);
  await contentReady(worker, funTab.id);

  // A web page (content-script world) may not use the test hook.
  const fromPage = await worker.evaluate(async (tabId) => {
    const [r] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => chrome.runtime.sendMessage({ type: 'pockets/test-set', settings: { countdownSeconds: 30 } }),
    });
    return r.result;
  }, funTab.id);
  expect(fromPage).toEqual({ ok: false });

  // Our own extension page may: it sets the distracting list, and switches working mode with the popup's message.
  const ext = await context.newPage();
  await ext.goto(`chrome-extension://${id}/popup.html`);
  const extSend = (m: object) => ext.evaluate((msg) => chrome.runtime.sendMessage(msg), m);
  expect(await extSend({ type: 'pockets/test-set', settings: { distracting: ['distracting.test'], countdownSeconds: 3, staleHours: 24 } }))
    .toEqual({ ok: true });
  expect(await worker.evaluate(async () => ((await chrome.storage.local.get("pocketsTestSettings")).pocketsTestSettings as { countdownSeconds?: number } | undefined)?.countdownSeconds))
    .toBe(3);

  // Working off: the distracting page in front is left alone.
  expect(await extSend({ type: 'pockets/set-working', on: false })).toEqual({ ok: true });
  await ext.close();
  await fun.bringToFront();
  expect((await tabs(worker)).find((t) => t.active)?.id).toBe(funTab.id);
  for (let i = 0; i < 2; i++) {
    await testSet(worker, { runtime: { lastDistractingTake: 0 }, tick: true });
    expect((await runtime(worker))?.visit ?? null, 'no visit with working off').toBeNull();
  }
  await sleep(3000);
  expect((await tabs(worker)).some((t) => t.id === funTab.id), 'not taken with working off').toBe(true);

  // Working on: the same page is taken (it is both target and stage).
  const ext2 = await context.newPage();
  await ext2.goto(`chrome-extension://${id}/popup.html`);
  expect(await ext2.evaluate(() => chrome.runtime.sendMessage({ type: 'pockets/set-working', on: true }))).toEqual({ ok: true });
  await ext2.close();
  await fun.bringToFront();
  await testSet(worker, { runtime: { lastDistractingTake: 0 }, tick: true });
  const v = await waitVisit(worker, (x) => x.targetTabId === funTab.id, 'a distracting visit');
  expect(v).toMatchObject({ reason: 'distracting', stageTabId: funTab.id });
  await tabGone(worker, funTab.id);
  expect((await tabs(worker)).map((t) => t.url)).toEqual([plainUrl]);
  expect((await taken(worker)).map((t) => [t.url, t.reason])).toEqual([[funUrl, 'distracting']]);
});

test('stage on chrome://newtab: nothing is closed after two ticks; with a web page in front the take happens', async ({ context, worker, server }) => {
  const targetUrl = serve(server, '/nt-target', page('nt1'));
  const otherUrl = serve(server, '/nt-other', page('other'));
  await open(context, targetUrl, context.pages()[0]);
  await sleep(150);
  const other = await open(context, otherUrl);
  await sleep(150);
  const newtab = await worker.evaluate(async () => (await chrome.tabs.create({ url: 'chrome://newtab', active: true })).id!);
  const target = await tabFor(worker, targetUrl);
  await contentReady(worker, target.id);
  await sleep(900);
  const before = await tabs(worker);
  expect(before.find((t) => t.active)?.id, 'the new tab page is in front').toBe(newtab);
  expect(before.find((t) => t.id === newtab)?.url).toMatch(/^chrome:\/\//);

  for (let i = 0; i < 2; i++) {
    await testSet(worker, { settings: QUICK_STALE, runtime: { lastStaleVisitEnd: 0 }, tick: true });
    expect((await runtime(worker))?.visit ?? null, 'no visit can start on chrome://newtab').toBeNull();
  }
  await sleep(4000);
  expect((await tabs(worker)).map((t) => t.id).sort(), 'nothing closed').toEqual(before.map((t) => t.id).sort());
  expect(await taken(worker)).toEqual([]);

  // Positive control: the same target, with a web page as the stage, is taken.
  await other.bringToFront();
  await contentReady(worker, (await tabFor(worker, otherUrl)).id);
  await testSet(worker, { runtime: { lastStaleVisitEnd: 0 }, tick: true });
  await waitVisit(worker, (x) => x.targetTabId === target.id, 'a stale visit once a web page is in front');
  await tabGone(worker, target.id);
});

test('iframe: a stage page with iframes runs the visit to the end (only the top frame answers)', async ({ context, worker, server }) => {
  const inner = serve(server, '/frame-inner', page('inner', '<p>inside a frame</p>'));
  const innerCross = otherOrigin(server) + '/frame-inner';
  const s = await threeTabs(context, worker, {
    target: serve(server, '/if-target', page('f1')),
    other: serve(server, '/if-other', page('other')),
    stage: serve(server, '/if-stage', page('stage with frames',
      `<iframe src="${inner}" style="width:300px;height:120px"></iframe>` +
      `<iframe src="${innerCross}" style="width:300px;height:120px"></iframe>`)),
  });
  // Both frames have loaded, with the content script in each (all_frames).
  await expect.poll(() => s.stagePage.frames().length).toBe(3);
  await expectStaleSetup(worker, s.target.id, s.stage.id);

  await testSet(worker, { settings: QUICK_STALE, tick: true });
  const v = await waitVisit(worker, (x) => x.targetTabId === s.target.id, 'a stale visit');
  expect(v.stageTabId).toBe(s.stage.id);
  await waitVisit(worker, (x) => x.visitId === v.visitId && x.cardShown, 'card-shown from the top frame');
  await tabGone(worker, s.target.id);
  await expect.poll(async () => (await taken(worker)).find((t) => t.url === s.target.url)?.noticeTabId).toBe(s.stage.id);
  expect((await tabs(worker)).map((t) => t.id).sort()).toEqual([s.other.id, s.stage.id].sort());
});

test('iframe: typing into an input inside a frame of a stale tab means it is never taken', async ({ context, worker, server }) => {
  serve(server, '/frame-form', page('form', '<input id="field" type="text">'));
  const formCross = otherOrigin(server) + '/frame-form';
  const typedUrl = serve(server, '/typed-target', page('typed', `<iframe src="${formCross}" style="width:300px;height:120px"></iframe>`));
  // The typed tab is the oldest, so without the typing it would be the pick. A younger stale tab is the control.
  const typedPage = await open(context, typedUrl, context.pages()[0]);
  await expect.poll(() => typedPage.frames().length).toBe(2);
  const typed = await tabFor(worker, typedUrl);
  await contentReady(worker, typed.id);
  await typedPage.frameLocator('iframe').locator('#field').pressSequentially('hello', { delay: 20 });
  await expect.poll(async () => (await runtime(worker))?.typedIn ?? [], { message: 'typing in the frame was reported' }).toContain(typed.id);

  await sleep(150);
  const youngerUrl = serve(server, '/typed-younger', page('younger'));
  await open(context, youngerUrl);
  await sleep(150);
  const stageUrl = serve(server, '/typed-stage', page('stage'));
  await open(context, stageUrl);
  const younger = await tabFor(worker, youngerUrl);
  const stage = await tabFor(worker, stageUrl);
  await contentReady(worker, younger.id);
  await contentReady(worker, stage.id);
  await expectStaleSetup(worker, typed.id, stage.id);

  await testSet(worker, { settings: QUICK_STALE, tick: true });
  const v = await waitVisit(worker, () => true, 'a stale visit');
  expect(v.targetTabId, 'the typed-in tab is skipped; the younger stale tab is picked').toBe(younger.id);
  await tabGone(worker, younger.id);

  // Another tick with the gap reset: still not the typed-in tab.
  await testSet(worker, { runtime: { lastStaleVisitEnd: 0 }, tick: true });
  expect((await runtime(worker))?.visit ?? null).toBeNull();
  await sleep(2000);
  expect((await tabs(worker)).some((t) => t.id === typed.id), 'typed-in tab still open').toBe(true);
  expect((await taken(worker)).map((t) => t.url)).toEqual([youngerUrl]);
});

test('top layer: a full-viewport modal dialog opened after the card appears means the stale tab is NOT closed', async ({ context, worker, server }) => {
  const s = await threeTabs(context, worker, {
    target: serve(server, '/modal-target', page('m1')),
    other: serve(server, '/modal-other', page('other')),
    stage: serve(server, '/modal-stage', page('stage')),
  });
  await expectStaleSetup(worker, s.target.id, s.stage.id);

  await testSet(worker, { settings: QUICK_STALE, tick: true });
  const v = await waitVisit(worker, (x) => x.targetTabId === s.target.id, 'a stale visit for the target');
  await waitVisit(worker, (x) => x.visitId === v.visitId && x.cardShown, 'card-shown on the stage');

  // The page puts a full-viewport modal dialog in the top layer, over the stage and its card (the reproduction).
  await s.stagePage.evaluate(() => {
    const d = document.createElement('dialog');
    d.style.cssText = 'width:100vw;height:100vh;max-width:none;max-height:none;margin:0;padding:0;border:0;background:#0a0;';
    d.textContent = 'MODAL';
    document.body.appendChild(d);
    d.showModal();
  });
  await shot(s.stagePage, 'modal-over-card');

  // The countdown (3 s) ends while the card is covered: the stage reports hidden and the visit is abandoned.
  await expect.poll(async () => (await runtime(worker))?.visit ?? null, { message: 'visit ended without a take', timeout: 15_000 }).toBeNull();
  await sleep(2000);
  expect((await tabs(worker)).map((t) => t.id).sort(), 'nothing closed').toEqual([s.target.id, s.other.id, s.stage.id].sort());
  expect(await taken(worker)).toEqual([]);
  expect((await runtime(worker))!.spared[String(s.target.id)], 'not spared').toBeUndefined();
  // The target's title is put back (unmarked).
  await expect.poll(async () => (await tabFor(worker, s.target.url)).title).toBe('m1');
});

test('typed-in: a stale tab typed into is protected until it reloads, then it can be taken', async ({ context, worker, server }) => {
  serve(server, '/typed-reload-inner', page('inner'));
  serve(server, '/typed-reload-inner2', page('inner2'));
  const formUrl = serve(server, '/typed-reload', page('form', '<input id="field" type="text"><iframe id="fr" src="/typed-reload-inner"></iframe>'));
  const formPage = await open(context, formUrl, context.pages()[0]);
  const form = await tabFor(worker, formUrl);
  await contentReady(worker, form.id);
  await formPage.locator('#field').pressSequentially('hello', { delay: 20 });
  await expect.poll(async () => (await runtime(worker))?.typedIn ?? [], { message: 'typing was reported' }).toContain(form.id);

  // Same-document navigations and an iframe load do not end the protection (no new top-frame document).
  await formPage.evaluate(() => {
    history.pushState({}, '', location.pathname + '#route-a');
    location.hash = 'route-b';
    (document.getElementById('fr') as HTMLIFrameElement).src = '/typed-reload-inner2';
  });
  await expect.poll(() => formPage.frames().some((f) => f.url().endsWith('/typed-reload-inner2'))).toBe(true);
  await sleep(1000);
  expect((await runtime(worker))?.typedIn ?? [], 'still protected after pushState, hash change and iframe load').toContain(form.id);

  await sleep(150);
  const otherUrl = serve(server, '/typed-reload-other', page('other'));
  await open(context, otherUrl);
  await sleep(150);
  const stageUrl = serve(server, '/typed-reload-stage', page('stage'));
  await open(context, stageUrl);
  const stage = await tabFor(worker, stageUrl);
  await contentReady(worker, (await tabFor(worker, otherUrl)).id);
  await contentReady(worker, stage.id);
  await expectStaleSetup(worker, form.id, stage.id);

  // Protected: the typed-in tab is the oldest, yet the other background tab is picked; once that is gone, nothing is.
  await testSet(worker, { settings: QUICK_STALE, tick: true });
  const first = await waitVisit(worker, () => true, 'a stale visit');
  expect(first.targetTabId, 'the typed-in tab is skipped').not.toBe(form.id);
  await tabGone(worker, first.targetTabId);
  await testSet(worker, { runtime: { lastStaleVisitEnd: 0 }, tick: true });
  expect((await runtime(worker))?.visit ?? null, 'still protected: no visit').toBeNull();

  // Reload the typed-in tab in the background (it stays the least recently used tab): the protection ends.
  await worker.evaluate((id) => chrome.tabs.reload(id), form.id);
  await expect.poll(async () => (await runtime(worker))?.typedIn ?? [], { message: 'typing forgotten after the reload' }).not.toContain(form.id);
  await contentReady(worker, form.id);
  expect((await tabs(worker)).find((t) => t.active)?.id, 'the stage is still in front').toBe(stage.id);

  await testSet(worker, { runtime: { lastStaleVisitEnd: 0 }, tick: true });
  const v = await waitVisit(worker, (x) => x.targetTabId === form.id, 'a stale visit for the reloaded tab');
  expect(v.reason).toBe('stale');
  await tabGone(worker, form.id);
});

test('top layer in shadow DOM: a modal dialog opened inside a web component after the card appears means NO take', async ({ context, worker, server }) => {
  const s = await threeTabs(context, worker, {
    target: serve(server, '/sd-target', page('sd1')),
    other: serve(server, '/sd-other', page('other')),
    stage: serve(server, '/sd-stage', page('stage')),
  });
  await expectStaleSetup(worker, s.target.id, s.stage.id);

  await testSet(worker, { settings: QUICK_STALE, tick: true });
  const v = await waitVisit(worker, (x) => x.targetTabId === s.target.id, 'a stale visit for the target');
  await waitVisit(worker, (x) => x.visitId === v.visitId && x.cardShown, 'card-shown on the stage');

  // document.querySelector('dialog:modal') cannot see this dialog; only the hit test can.
  const unseen = await s.stagePage.evaluate(() => {
    const comp = document.createElement('x-overlay');
    const root = comp.attachShadow({ mode: 'open' });
    const d = document.createElement('dialog');
    d.style.cssText = 'width:100vw;height:100vh;max-width:none;max-height:none;margin:0;padding:0;border:0;background:#00a;';
    d.textContent = 'MODAL IN SHADOW DOM';
    root.appendChild(d);
    document.body.appendChild(comp);
    d.showModal();
    return document.querySelector('dialog:modal') === null;
  });
  expect(unseen, 'the dialog is invisible to document.querySelector').toBe(true);

  await expect.poll(async () => (await runtime(worker))?.visit ?? null, { message: 'visit ended without a take', timeout: 15_000 }).toBeNull();
  await sleep(2000);
  expect((await tabs(worker)).map((t) => t.id).sort(), 'nothing closed').toEqual([s.target.id, s.other.id, s.stage.id].sort());
  expect(await taken(worker)).toEqual([]);
});

test('slow page: typing in a frame before the top document has finished loading keeps the tab protected', async ({ context, worker, server }) => {
  serve(server, '/slow-form', page('form', '<input id="field" type="text">'));
  const formCross = otherOrigin(server) + '/slow-form';
  let release!: () => void;
  const released = new Promise<void>((r) => { release = r; });
  // The top document is streamed: the iframe arrives at once, the end of the document only when the test says so.
  // Until then the top frame has not reached document_idle (nor DOMContentLoaded).
  server.route('/slow-top', (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.write('<!doctype html><html><head><title>slow</title></head><body style="margin:0;background:#fff">' +
      `<iframe src="${formCross}" style="width:300px;height:120px"></iframe>` + `<!-- ${'x'.repeat(4096)} -->`);
    void released.then(() => res.end('<p id="done">done</p></body></html>'));
  });
  const slowUrl = server.origin + '/slow-top';
  const p = context.pages()[0];
  await p.goto(slowUrl, { waitUntil: 'commit' });
  await expect.poll(() => p.frames().length, { message: 'the iframe is in the page while the top still loads' }).toBe(2);
  const tab = await tabFor(worker, slowUrl);
  const field = p.frameLocator('iframe').locator('#field');
  // Type until the frame's content script has seen it (it starts at the frame's own document_idle).
  await expect.poll(async () => {
    await field.pressSequentially('a', { delay: 10 });
    return (await runtime(worker))?.typedIn ?? [];
  }, { message: 'typing in the frame was reported before the top finished', timeout: 20_000, intervals: [200] }).toContain(tab.id);
  expect(await p.evaluate(() => document.readyState), 'the top document is still loading').toBe('loading');

  release();
  await p.waitForLoadState('load');
  await contentReady(worker, tab.id);
  await sleep(1500);
  expect((await runtime(worker))?.typedIn ?? [], 'still protected once the top document has loaded').toContain(tab.id);
});

test('install or update: a tab open before Pockets started gets the content script, hosts a visit at once, and is not taken until it reloads', async ({ context, worker, server }) => {
  // A page whose content script predates the running build. The fixture loads the extension at launch, and
  // chrome.runtime.reload() does not bring an unpacked extension back under Playwright (checked: no worker returns and
  // its pages are blocked), so this is simulated in the page's isolated world: the running instance is torn down and its
  // records are made to read as a dead context, which is what an update leaves behind. Then the background's injection
  // routine (the one onInstalled runs) is called through the test hook.
  const preUrl = serve(server, '/pre-install', page('pre'));
  const prePage = await open(context, preUrl, context.pages()[0]);
  const pre = await tabFor(worker, preUrl);
  await contentReady(worker, pre.id);
  expect((await runtime(worker))?.typedIn ?? [], 'a normally loaded page is not typed in').not.toContain(pre.id);

  const orphaned = await worker.evaluate(async (tabId) => {
    const [r] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const g = globalThis as unknown as Record<string, { dispose?: () => void; alive: () => boolean } | undefined>;
        const content = g.__pocketsContent;
        const start = g.__pocketsStart;
        if (!content || !start) return false;
        content.dispose?.();
        content.alive = () => { throw new Error('Extension context invalidated.'); };
        start.alive = () => false;
        return true;
      },
    });
    return r.result;
  }, pre.id);
  expect(orphaned, 'the page had a running content script and a document_start record').toBe(true);
  // Torn down: the page no longer answers.
  const answers = await worker.evaluate((id) => chrome.tabs.sendMessage(id, { type: 'pockets/ping' }, { frameId: 0 }).then((r) => r?.from === 'content', () => false), pre.id);
  expect(answers, 'the orphaned instance does not answer').toBe(false);

  const first = await testSet(worker, { inject: true });
  expect(first.injected, 'the routine injected into the open http tab').toContain(pre.id);
  await expect.poll(async () => (await runtime(worker))?.typedIn ?? [], { message: 'the injected tab counts as typed in' }).toContain(pre.id);
  await contentReady(worker, pre.id);
  // A second injection (declared + programmatic, or a repeated install event) is a no-op in that frame.
  expect((await testSet(worker, { inject: true })).injected).toContain(pre.id);

  // A tab opened now (declared scripts, page-loaded at document_start) is the stale target; the injected page is the stage.
  const targetUrl = serve(server, '/post-install-target', page('t'));
  await open(context, targetUrl);
  const target = await tabFor(worker, targetUrl);
  await contentReady(worker, target.id);
  await prePage.bringToFront();
  await expectStaleSetup(worker, target.id, pre.id);
  expect((await runtime(worker))?.typedIn ?? [], 'the new tab is not typed in').not.toContain(target.id);

  await testSet(worker, { settings: QUICK_STALE, runtime: { lastStaleVisitEnd: 0 }, tick: true });
  const v = await waitVisit(worker, (x) => x.targetTabId === target.id, 'a stale visit staged on the injected page');
  expect(v.stageTabId).toBe(pre.id);
  await waitVisit(worker, (x) => x.visitId === v.visitId && x.cardShown, 'card-shown from the injected content script');
  await tabGone(worker, target.id);
  await expect.poll(async () => (await taken(worker)).find((t) => t.url === targetUrl)?.noticeTabId).toBe(pre.id);
  expect(await prePage.evaluate(() => document.querySelectorAll('pockets-stage').length), 'one stage host, not one per injection').toBe(1);

  // The injected page itself, now a stale background tab, is protected until it next loads a page.
  const frontUrl = serve(server, '/post-install-front', page('front'));
  await open(context, frontUrl);
  const front = await tabFor(worker, frontUrl);
  await contentReady(worker, front.id);
  await expect.poll(async () => (await runtime(worker))?.visit ?? null).toBeNull();
  await sleep(900);
  await testSet(worker, { runtime: { lastStaleVisitEnd: 0 }, tick: true });
  expect((await runtime(worker))?.visit ?? null, 'the injected tab is not taken before it reloads').toBeNull();
  expect((await tabs(worker)).some((t) => t.id === pre.id)).toBe(true);

  await worker.evaluate((id) => chrome.tabs.reload(id), pre.id);
  await expect.poll(async () => (await runtime(worker))?.typedIn ?? [], { message: 'reloading ends the protection' }).not.toContain(pre.id);
  await contentReady(worker, pre.id);
  expect((await tabs(worker)).find((t) => t.active)?.id).toBe(front.id);
  await testSet(worker, { runtime: { lastStaleVisitEnd: 0 }, tick: true });
  await waitVisit(worker, (x) => x.targetTabId === pre.id, 'the reloaded tab can be taken');
  await tabGone(worker, pre.id);
});

// Playwright turns the back/forward cache off by default (--disable-back-forward-cache); this test turns it back on.
const bfTest = base.extend<{ context: BrowserContext }>({
  context: async ({ userDataDir }, use) => {
    const context = await launchExtensionContext(userDataDir, [], ['--disable-back-forward-cache']);
    await use(context);
    await context.close().catch(() => {});
  },
});

bfTest('bfcache: typing on a page, leaving it and coming Back from the cache protects the tab again', async ({ context, worker, server }) => {
  const record = '<script>addEventListener("pageshow", (e) => { window.__shows = (window.__shows || []).concat(e.persisted); });</script>';
  const aUrl = serve(server, '/bf-a', page('a', '<input id="field" type="text">' + record));
  const bUrl = serve(server, '/bf-b', page('b'));
  const p = await open(context, aUrl, context.pages()[0]);
  const tab = await tabFor(worker, aUrl);
  await contentReady(worker, tab.id);
  await p.locator('#field').pressSequentially('hello', { delay: 20 });
  await expect.poll(async () => (await runtime(worker))?.typedIn ?? [], { message: 'typing on A reported' }).toContain(tab.id);

  await p.goto(bUrl);
  await expect.poll(async () => (await runtime(worker))?.typedIn ?? [], { message: "B's page-loaded clears A's typing" }).not.toContain(tab.id);

  // A restore from the cache fires pageshow, not load, so wait for the commit only.
  await p.goBack({ waitUntil: 'commit' });
  await expect.poll(() => p.evaluate(() => ((window as unknown as { __shows?: boolean[] }).__shows ?? []).length)).toBeGreaterThan(0);
  const shows = await p.evaluate(() => (window as unknown as { __shows?: boolean[] }).__shows ?? []);
  bfTest.skip(shows[shows.length - 1] !== true, `A was not restored from the back/forward cache under Playwright (pageshow persisted: ${JSON.stringify(shows)}); covered by the unit tests only`);
  await expect.poll(async () => (await runtime(worker))?.typedIn ?? [], { message: 'A, restored from the cache, reports its typing again' }).toContain(tab.id);
  // The top frame still answers after the restore.
  await contentReady(worker, tab.id);
  await sleep(1000);
  expect((await runtime(worker))?.typedIn ?? []).toContain(tab.id);
});

test('same-origin frame and popup: content.js that ran in the initial about:blank does not block the real document', async ({ context, worker, server }) => {
  // Chromium keeps the Window (and maybe the isolated world's globals) when an initial about:blank is replaced by a
  // same-origin document. With match_about_blank, content.js may have run in that blank document first; the guard
  // must not then make the real document's content.js a no-op.
  serve(server, '/so-form', page('so form', '<input id="field" type="text">'));
  const hostUrl = serve(server, '/so-host', page('so host', '<iframe src="/so-form" style="width:300px;height:120px"></iframe>'));
  const p = await open(context, hostUrl, context.pages()[0]);
  await expect.poll(() => p.frames().length).toBe(2);
  const host = await tabFor(worker, hostUrl);
  await contentReady(worker, host.id);
  const field = p.frameLocator('iframe').locator('#field');
  await expect.poll(async () => {
    await field.pressSequentially('a', { delay: 10 });
    return (await runtime(worker))?.typedIn ?? [];
  }, { message: 'typing in a same-origin frame was reported', timeout: 15_000, intervals: [300] }).toContain(host.id);

  // A same-origin popup whose response is held, so its initial about:blank document is around first.
  server.route('/so-popup', (_req, res) => {
    setTimeout(() => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(page('so popup', '<input id="field" type="text">'));
    }, 1200);
  });
  const popupUrl = server.origin + '/so-popup';
  const [popup] = await Promise.all([context.waitForEvent('page'), p.evaluate((u) => { window.open(u, '_blank'); }, popupUrl)]);
  await popup.waitForLoadState('load');
  expect(popup.url()).toBe(popupUrl);
  const pop = await tabFor(worker, popupUrl);
  await contentReady(worker, pop.id);
  expect((await runtime(worker))?.typedIn ?? [], 'a freshly loaded popup is not typed in').not.toContain(pop.id);
  await popup.locator('#field').pressSequentially('hello', { delay: 20 });
  await expect.poll(async () => (await runtime(worker))?.typedIn ?? [], { message: 'typing in the popup was reported' }).toContain(pop.id);
});
