// Task 1: verify the browser behaviours the design assumes.
//
// Each test records what it observed as annotations of type "finding" (and "detail").
// Outcomes:
//   pass             test is green
//   fail             a soft assertion fails, so the test is red but the remaining checks still run
//   could not verify test.skip() at runtime with the reason
// Exception: test 5's assumption failed (docs/verification.md, row 5), so it asserts that recorded failure and is
// green while Chromium still behaves that way; it turns red if the behaviour changes.
//
// The stubs only answer `pockets/ping`, so where a test needs the content script to act it runs
// code in the tab's isolated world with chrome.scripting.executeScript, which is the same world
// a content script runs in.
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page, Worker } from '@playwright/test';
import { test, expect, launchExtensionContext, launchRawExtensionBrowser, getServiceWorker } from './fixtures';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function note(type: 'finding' | 'detail', description: string) {
  test.info().annotations.push({ type, description });
  console.log(`[${test.info().title}] ${type}: ${description}`);
}

async function tabIdFor(worker: Worker, url: string): Promise<number> {
  return worker.evaluate(async (u) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((t) => t.url === u);
    if (!tab || tab.id === undefined) throw new Error('no tab for ' + u);
    return tab.id;
  }, url);
}

// A red 16x16 PNG, made once so the icon swap uses a data: URL as the real extension will.
const RED_ICON =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR42mP4z8BAEmIY1TCqYfhqAACQ+f8B8u7oVwAAAABJRU5ErkJggg==';


interface SwapOutcome {
  /** What the injected function returned, or the error executeScript gave. */
  exec: { ok: true; title: string; visibility: string; href: string } | { ok: false; error: string };
  /** The tab as tabs.get reports it after waiting for the swap to show. */
  tab: { title?: string; favIconUrl?: string; active: boolean; discarded: boolean; status?: string };
}

/**
 * Runs inside the service worker (it is serialised, so it must not use anything from this file).
 * Does the icon and title swap in the tab's isolated world, then polls tabs.get until it shows.
 */
async function swapInWorker(a: { tabId: number; title: string; icon: string; waitMs: number }): Promise<SwapOutcome> {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  let exec: SwapOutcome['exec'];
  try {
    const injection = chrome.scripting.executeScript({
      target: { tabId: a.tabId },
      args: [a.title, a.icon],
      func: (t: string, i: string) => {
        document.title = t;
        document.querySelectorAll('link[rel~="icon"]').forEach((l) => l.remove());
        const link = document.createElement('link');
        link.rel = 'icon';
        link.href = i;
        document.head.appendChild(link);
        return { title: document.title, visibility: document.visibilityState, href: location.href };
      },
    });
    const timeout = sleep(8000).then(() => {
      throw new Error('executeScript timed out after 8000ms');
    });
    const results = await Promise.race([injection, timeout]);
    exec = { ok: true, ...(results[0].result as { title: string; visibility: string; href: string }) };
  } catch (e) {
    exec = { ok: false, error: String(e instanceof Error ? e.message : e) };
  }
  const end = Date.now() + a.waitMs;
  let t = await chrome.tabs.get(a.tabId);
  while (Date.now() < end && !(t.title === a.title && t.favIconUrl === a.icon)) {
    await sleep(100);
    t = await chrome.tabs.get(a.tabId);
  }
  return {
    exec,
    tab: { title: t.title, favIconUrl: t.favIconUrl, active: t.active, discarded: t.discarded, status: t.status },
  };
}

/** Runs inside the service worker: open a background tab and wait until it has loaded. */
async function openBackgroundTab(url: string): Promise<number> {
  const tab = await chrome.tabs.create({ url, active: false });
  for (let i = 0; i < 100; i++) {
    const t = await chrome.tabs.get(tab.id!);
    if (t.status === 'complete') break;
    await new Promise((r) => setTimeout(r, 100));
  }
  return tab.id!;
}

const short = (tab: SwapOutcome['tab']) => ({ ...tab, favIconUrl: tab.favIconUrl?.slice(0, 32) });

test('1. lastAccessed survives restart', async ({ userDataDir, server }) => {
  const urls = ['a', 'b', 'c'].map((n) => `${server.origin}/restart-${n}`);

  let context = await launchExtensionContext(userDataDir);
  let worker = await getServiceWorker(context);
  const pages: Page[] = [];
  for (const url of urls) {
    const page = await context.newPage();
    await page.goto(url);
    pages.push(page);
  }
  // Activate each in turn with gaps so the three times are distinct; c ends up active.
  for (const page of pages) {
    await page.bringToFront();
    await sleep(1200);
  }

  type Row = { url?: string; lastAccessed?: number; active: boolean };
  const query = (w: Worker) =>
    w.evaluate(async () =>
      (await chrome.tabs.query({})).map((t) => ({ url: t.url, lastAccessed: t.lastAccessed, active: t.active })),
    ) as Promise<Row[]>;

  const before = await query(worker);
  note('detail', `before: ${JSON.stringify(before.filter((t) => urls.includes(t.url!)))}`);
  await sleep(3000); // so "kept" and "reset to relaunch time" cannot be confused
  await context.close();

  // Turn on "Continue where you left off", which is how a real user gets session restore.
  const prefsPath = join(userDataDir, 'Default', 'Preferences');
  const prefs = JSON.parse(await readFile(prefsPath, 'utf8'));
  prefs.session = { ...(prefs.session ?? {}), restore_on_startup: 1 };
  await writeFile(prefsPath, JSON.stringify(prefs));

  const relaunchedAt = Date.now();
  context = await launchExtensionContext(userDataDir);
  try {
    worker = await getServiceWorker(context);
    await sleep(2000);
    const after = await query(worker);
    note('detail', `relaunched at ${relaunchedAt}; after: ${JSON.stringify(after.filter((t) => urls.includes(t.url!)))}`);

    const restored = urls.filter((u) => after.some((t) => t.url === u));
    if (restored.length === 0) {
      note('finding', 'Session restore did not reopen the tabs in this environment.');
      test.skip(true, 'session restore did not reopen any tab, so lastAccessed could not be compared');
    }
    expect.soft(restored, 'all three tabs restored').toEqual(urls);

    const lines: string[] = [];
    for (const url of urls) {
      const b = before.find((t) => t.url === url)!;
      const a = after.find((t) => t.url === url);
      if (!a) continue;
      const drift = Math.round(a.lastAccessed! - b.lastAccessed!);
      const reset = a.lastAccessed! >= relaunchedAt;
      lines.push(`${url.split('/').pop()}: was active=${b.active}, drift ${drift} ms${reset ? ', RESET to after relaunch' : ''}`);
      // A tab that was active at shutdown is re-activated by restore and legitimately gets a fresh time.
      if (!b.active) {
        expect.soft(reset, `${url} lastAccessed must not reset to relaunch time`).toBe(false);
        expect.soft(Math.abs(drift), `${url} lastAccessed kept within 1s`).toBeLessThan(1000);
      }
    }
    note('finding', lines.join('; '));
  } finally {
    await context.close().catch(() => {});
  }
});

test('2. undo restores position and history', async ({ context, worker, server }) => {
  const left = `${server.origin}/undo-left`;
  const first = `${server.origin}/undo-first`;
  const second = `${server.origin}/undo-second`;
  const right = `${server.origin}/undo-right`;

  const leftPage = await context.newPage();
  await leftPage.goto(left);
  const target = await context.newPage();
  await target.goto(first);
  await target.goto(second);
  const rightPage = await context.newPage();
  await rightPage.goto(right);

  const targetId = await tabIdFor(worker, second);
  const original = await worker.evaluate(async (id) => {
    const t = await chrome.tabs.get(id);
    return { index: t.index, windowId: t.windowId };
  }, targetId);

  const result = await worker.evaluate(
    async ({ id, url }) => {
      await chrome.tabs.remove(id);
      await new Promise((r) => setTimeout(r, 500));
      const closed = await chrome.sessions.getRecentlyClosed({ maxResults: 10 });
      const entry = closed.find((s) => s.tab?.url === url);
      if (!entry?.tab?.sessionId) return { error: 'closed tab not in sessions.getRecentlyClosed', closed };
      const session = await chrome.sessions.restore(entry.tab.sessionId);
      const tab = session.tab!;
      // Wait for the restored tab to finish loading.
      for (let i = 0; i < 50; i++) {
        const t = await chrome.tabs.get(tab.id!);
        if (t.status === 'complete') break;
        await new Promise((r) => setTimeout(r, 100));
      }
      const t = await chrome.tabs.get(tab.id!);
      return { id: t.id!, index: t.index, windowId: t.windowId, url: t.url };
    },
    { id: targetId, url: second },
  );
  note('detail', `original ${JSON.stringify(original)}; restored ${JSON.stringify(result)}`);
  if ('error' in result) {
    expect.soft(result.error, 'sessions.restore found the closed tab').toBeUndefined();
    note('finding', String(result.error));
    return;
  }

  expect.soft(result.url, 'restored URL').toBe(second);
  expect.soft(result.windowId, 'restored into the same window').toBe(original.windowId);
  expect.soft(result.index, 'restored at the same index').toBe(original.index);

  const nav = await worker.evaluate(async (id) => {
    const [{ result: length }] = await chrome.scripting.executeScript({
      target: { tabId: id },
      func: () => history.length,
    });
    await chrome.scripting.executeScript({ target: { tabId: id }, func: () => history.back() });
    let url = '';
    for (let i = 0; i < 50; i++) {
      await new Promise((r) => setTimeout(r, 100));
      const t = await chrome.tabs.get(id);
      url = t.url ?? '';
      if (t.status === 'complete' && !url.endsWith('/undo-second')) break;
    }
    return { length, urlAfterBack: url };
  }, result.id);
  note('detail', `history.length ${nav.length}; after history.back(): ${nav.urlAfterBack}`);
  expect.soft(nav.urlAfterBack, 'history.back() returns to the first page').toBe(first);

  note(
    'finding',
    `index ${original.index} -> ${result.index}, same window ${result.windowId === original.windowId}, ` +
      `history.length ${nav.length}, back() went to ${nav.urlAfterBack.split('/').pop()}`,
  );
});

// Runs in the raw browser: under Playwright every page reports visibilityState "visible", so a
// Playwright page is never a real background tab.
test('3. background tab can change icon and title', async ({ userDataDir, server }) => {
  const browser = await launchRawExtensionBrowser(userDataDir);
  try {
    const tabId = await browser.evaluate(openBackgroundTab, `${server.origin}/bg-tab`);
    const title = 'Pockets swapped title';
    const out = await browser.evaluate(swapInWorker, { tabId, title, icon: RED_ICON, waitMs: 5000 });
    note('detail', `executeScript: ${JSON.stringify(out.exec)}; tabs.get: ${JSON.stringify(short(out.tab))}`);

    expect(out.tab.active, 'the tab under test must be in the background').toBe(false);
    expect.soft(out.exec.ok, 'swap ran in the tab').toBe(true);
    if (out.exec.ok) expect.soft(out.exec.visibility, 'tab is really hidden').toBe('hidden');
    expect.soft(out.tab.title, 'tabs.get title').toBe(title);
    expect.soft(out.tab.favIconUrl, 'tabs.get favIconUrl').toBe(RED_ICON);

    note(
      'finding',
      `background tab (visibilityState ${out.exec.ok ? out.exec.visibility : 'unknown'}): ` +
        `title ${out.tab.title === title ? 'changed' : 'NOT changed'}, ` +
        `favIconUrl ${out.tab.favIconUrl === RED_ICON ? 'changed to the data: URL' : 'NOT changed'}. ` +
        'Seen through tabs.get; the painted tab strip itself cannot be inspected here.',
    );
  } finally {
    await browser.close();
  }
});

test('4. stage draws under strict CSP', async ({ context, worker, server }) => {
  server.route('/csp', (_req, res) => {
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': "default-src 'none'",
    });
    res.end(
      '<!doctype html><html><head><title>strict csp</title></head><body>' +
        '<p>strict</p><script>document.body.dataset.inline = "ran";</script></body></html>',
    );
  });
  const url = `${server.origin}/csp`;
  const page = await context.newPage();
  await page.goto(url);
  await page.bringToFront();
  const tabId = await tabIdFor(worker, url);

  const [{ result }] = await worker.evaluate(
    async ({ tabId, icon }) =>
      chrome.scripting.executeScript({
        target: { tabId },
        args: [icon],
        func: async (dataUrl: string) => {
          const out: Record<string, unknown> = {};
          // Control: the page's own inline script must have been blocked by the CSP.
          out.inlineScriptRan = document.body.dataset.inline === 'ran';

          const host = document.createElement('div');
          host.id = 'pockets-stage-test';
          document.documentElement.appendChild(host);
          const root = host.attachShadow({ mode: 'open' });

          // Style inside the shadow root, two ways: a <style> element and a constructed sheet.
          const style = document.createElement('style');
          style.textContent = '.probe-a { width: 37px; }';
          root.appendChild(style);
          try {
            const sheet = new CSSStyleSheet();
            sheet.replaceSync('.probe-b { width: 41px; }');
            root.adoptedStyleSheets = [sheet];
          } catch (e) {
            out.constructedSheetError = String(e);
          }
          const probeA = document.createElement('div');
          probeA.className = 'probe-a';
          const probeB = document.createElement('div');
          probeB.className = 'probe-b';
          root.append(probeA, probeB);
          out.styleElementApplied = getComputedStyle(probeA).width === '37px';
          out.constructedSheetApplied = getComputedStyle(probeB).width === '41px';

          const canvas = document.createElement('canvas');
          canvas.width = 200;
          canvas.height = 200;
          canvas.style.cssText =
            'position:fixed;left:0;top:0;width:200px;height:200px;pointer-events:none;z-index:2147483647';
          root.appendChild(canvas);
          const ctx = canvas.getContext('2d')!;
          ctx.fillStyle = 'rgb(255, 0, 0)';
          ctx.fillRect(0, 0, 100, 100);
          out.pixel = Array.from(ctx.getImageData(10, 10, 1, 1).data);
          out.canvasLaidOut = canvas.getBoundingClientRect().width === 200;

          // A data: URL image drawn onto the canvas (img-src is 'none' for the page).
          try {
            const img = new Image();
            img.src = dataUrl;
            await Promise.race([
              img.decode(),
              new Promise((_, reject) => setTimeout(() => reject(new Error('decode timeout')), 3000)),
            ]);
            ctx.drawImage(img, 120, 120);
            out.dataImagePixel = Array.from(ctx.getImageData(125, 125, 1, 1).data);
          } catch (e) {
            out.dataImageError = String(e);
          }
          return out;
        },
      }),
    { tabId, icon: RED_ICON },
  );
  const r = result as Record<string, unknown>;
  note('detail', `in page: ${JSON.stringify(r)}`);

  // Is the canvas actually painted on screen? Capture the visible tab and read the pixel back.
  const onScreen = await worker.evaluate(async (windowTabId) => {
    const tab = await chrome.tabs.get(windowTabId);
    try {
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
      const blob = await (await fetch(dataUrl)).blob(); // data: URL decode, no network
      const bitmap = await createImageBitmap(blob);
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0);
      return { pixel: Array.from(ctx.getImageData(10, 10, 1, 1).data) };
    } catch (e) {
      return { error: String(e) };
    }
  }, tabId);
  note('detail', `captureVisibleTab: ${JSON.stringify(onScreen)}`);

  expect(r.inlineScriptRan, 'control: the CSP must block the page inline script').toBe(false);
  expect.soft(r.pixel, 'canvas pixel reads back red').toEqual([255, 0, 0, 255]);
  expect.soft(r.canvasLaidOut, 'canvas laid out in the shadow root').toBe(true);
  if ('pixel' in onScreen) {
    expect.soft(onScreen.pixel, 'pixel is red on screen').toEqual([255, 0, 0, 255]);
  }

  note(
    'finding',
    `CSP live (inline script blocked: ${r.inlineScriptRan === false}). Shadow root + canvas drawn, pixel ${JSON.stringify(r.pixel)}; ` +
      `on screen ${'pixel' in onScreen ? JSON.stringify(onScreen.pixel) : `not captured (${onScreen.error})`}. ` +
      `<style> in shadow root applied: ${r.styleElementApplied}; constructed sheet applied: ${r.constructedSheetApplied}; ` +
      `data: image drawn: ${'dataImagePixel' in r ? JSON.stringify(r.dataImagePixel) : `no (${r.dataImageError})`}. ` +
      'The stage gets its sprites as data: URLs from the background (no web_accessible_resources), the path checked here.',
  );
});

// Runs in the raw browser: chrome.tabs.discard crashes Chromium while Playwright is attached to the
// pages (observed in Task 1; see docs/verification.md).
test('5. discarded tabs', async ({ userDataDir, server }) => {
  // Assumption 5 failed: the icon and title swap does not show on a discarded tab (docs/verification.md, row 5).
  // The test asserts that observed outcome, so it is green while Chromium behaves as recorded and turns red if the
  // swap ever starts to show (or the tab wakes, or Chromium crashes).
  //
  // It used to be marked test.fail() with the opposite assertions. Playwright's list reporter prints a red cross for
  // an expected failure on every run while counting it as passed, which was read as an intermittent failure in
  // full-suite runs (Task 13: "13 pass, 1 fail" with 13 tests). test.fail() also hid any real error, such as the raw
  // browser failing to attach, as an "expected" failure.
  const browser = await launchRawExtensionBrowser(userDataDir);
  try {
    const title = 'Pockets swapped title';

    // A: discard a fresh background tab, then try the swap and the ping.
    const fresh = await browser.evaluate(openBackgroundTab, `${server.origin}/discard-fresh`);
    const discarded = await browser.evaluate(async (id: number) => {
      try {
        const t = await chrome.tabs.discard(id);
        return { id: t?.id, discarded: t?.discarded, title: t?.title };
      } catch (e) {
        return { error: String(e) };
      }
    }, fresh);
    note('detail', `tabs.discard(${fresh}): ${JSON.stringify(discarded)}`);
    if ('error' in discarded || !discarded.discarded || discarded.id === undefined) {
      note('finding', `tabs.discard did not produce a discarded tab here: ${JSON.stringify(discarded)}`);
      test.skip(true, 'could not discard a tab in this environment');
      return;
    }
    const id = discarded.id; // the id can change on discard

    const ping = await browser.evaluate(async (tid: number) => {
      try {
        return { reply: await chrome.tabs.sendMessage(tid, { type: 'pockets/ping' }) };
      } catch (e) {
        return { error: String(e) };
      }
    }, id);
    note('detail', `content script ping: ${JSON.stringify(ping)}`);
    const out = await browser.evaluate(swapInWorker, { tabId: id, title, icon: RED_ICON, waitMs: 2000 });
    note('detail', `swap on discarded tab: executeScript ${JSON.stringify(out.exec)}; tabs.get ${JSON.stringify(short(out.tab))}`);

    // B: a tab swapped while awake, then discarded: what does the tab bar keep?
    const swappedFirst = await browser.evaluate(openBackgroundTab, `${server.origin}/discard-after-swap`);
    await browser.evaluate(swapInWorker, { tabId: swappedFirst, title, icon: RED_ICON, waitMs: 3000 });
    const kept = await browser.evaluate(async (tid: number) => {
      const t = await chrome.tabs.discard(tid);
      await new Promise((r) => setTimeout(r, 1000));
      const g = await chrome.tabs.get(t?.id ?? tid);
      return { discarded: g.discarded, title: g.title, favIconUrl: g.favIconUrl?.slice(0, 32) };
    }, swappedFirst);
    note('detail', `tab swapped then discarded: ${JSON.stringify(kept)}`);

    expect.soft(browser.crashed(), 'Chromium did not crash').toBe(false);
    expect.soft(out.tab.discarded, 'tab stayed discarded (the attempt did not wake it)').toBe(true);
    expect.soft(out.tab.title, 'title NOT swapped on a discarded tab (as recorded)').not.toBe(title);
    expect.soft(out.tab.favIconUrl, 'icon NOT swapped on a discarded tab (as recorded)').not.toBe(RED_ICON);

    note(
      'finding',
      `discarded tab: ping ${'error' in ping ? `failed ("${ping.error}")` : 'answered'}; ` +
        `executeScript ${out.exec.ok ? `resolved (in-page title "${out.exec.title}")` : `failed ("${out.exec.error}")`}; ` +
        `tab bar afterwards: discarded=${out.tab.discarded}, title "${out.tab.title}", ` +
        `icon ${out.tab.favIconUrl === RED_ICON ? 'swapped' : 'not swapped'}. ` +
        `A tab swapped while awake and then discarded keeps title "${kept.title}" ` +
        `and ${kept.favIconUrl?.startsWith('data:image/png') ? 'the swapped icon' : 'its own icon'}.`,
    );
  } finally {
    await browser.close();
  }
});
