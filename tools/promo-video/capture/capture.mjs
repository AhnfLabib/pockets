// Captures the real character page (dist-harness/character.html, the extension's own stage modules) as a
// frame-exact PNG sequence for the promo video. The page runs on Playwright's fake clock, stepped one video
// frame (1/30 s) at a time; CSS animations are paused and stepped by hand, so every frame is what the page would
// show at that instant. Run from tools/promo-video after `npm run build` in the repository root:
//   node capture/capture.mjs --seed 123 --variant landscape
//   node capture/capture.mjs --scan 1-20            (lists seeds with/without a quote bubble, one thumbnail each)
// The intro video's hook uses the crowded-tab-strip variant page (capture/build-harness.mjs builds it):
//   node capture/capture.mjs --seed 6 --variant portrait --page crowded --tabs 32 --target 12 --out intro
// --page crowded loads .harness/crowded.html instead of dist-harness/character.html; --out names the folder under
// public/footage/ (default: the variant); --dsf overrides the capture scale;
// --scheme dark captures the page in dark mode, --bare Pockets alone on a transparent page (the heist video). Without these flags the capture is exactly as before.
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const { chromium } = createRequire(path.join(root, 'package.json'))('playwright');

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
  return acc;
}, []));

// Mock browser size in CSS px and capture scale per variant.
const VARIANTS = {
  landscape: { width: 900, pageHeight: 470, dsf: 2 },
  // Narrower and shorter, captured at 2.5x: shown 980 px wide in the 1080-wide frame, Pockets reads large.
  portrait: { width: 480, pageHeight: 560, dsf: 2.5 },
};
const FPS = 30;
const T0 = Date.parse('2026-11-19T10:00:00Z');

/** The page to capture: the repository's character page, or the intro's crowded variant. */
function pageUrl() {
  if (args.page === 'crowded') {
    const u = pathToFileURL(path.join(here, '../.harness/crowded.html'));
    u.search = new URLSearchParams({ tabs: String(args.tabs ?? 32), target: String(args.target ?? 12), ...(args.bare ? { bare: '1' } : {}) }).toString();
    return u.href;
  }
  return pathToFileURL(path.join(root, 'dist-harness/character.html')).href;
}

const css = (v) => `
html,body{background:transparent!important;overflow:hidden}
.wrap{max-width:none;width:${v.width + 40}px;padding:20px;gap:0;display:block;margin:0}
.hero,.controls,.notes,.log,.status,h2{display:none!important}
.browser{width:${v.width}px}
#page{height:${v.pageHeight}px!important}`;

/** Pause every CSS animation/transition in the page, its iframe and the stage's shadow root, and set its time. */
async function stepAnimations(page, dt) {
  await page.evaluate((dt) => {
    const w = window;
    w.__animT ??= new WeakMap();
    const docs = [document];
    const f = document.getElementById('page');
    if (f?.contentDocument) docs.push(f.contentDocument);
    const anims = [];
    for (const d of docs) anims.push(...d.getAnimations());
    const root = w.__pockets?.root;
    if (root?.getAnimations) anims.push(...root.getAnimations());
    for (const a of new Set(anims)) {
      const t = w.__animT.has(a) ? w.__animT.get(a) + dt : 0;
      w.__animT.set(a, t);
      a.pause();
      a.currentTime = t;
    }
  }, dt);
}

async function open(browser, v) {
  const ctx = await browser.newContext({ viewport: { width: v.width + 40, height: v.pageHeight + 200 }, deviceScaleFactor: v.dsf, colorScheme: args.scheme === 'dark' ? 'dark' : 'light', reducedMotion: 'no-preference' });
  const page = await ctx.newPage();
  // A fixed start time and a fixed pause point, so the fake requestAnimationFrame ticks fall at the same instants
  // on every run. The rig and the choreography share one seeded rand, so their interleaving must not vary.
  await page.clock.install({ time: T0 });
  await page.goto(pageUrl());
  await page.waitForFunction(() => window.__pockets.ready, null, { timeout: 20000 });
  await page.addStyleTag({ content: css(v) });
  await page.waitForTimeout(200);
  await page.clock.pauseAt(T0 + 15000);
  return { ctx, page };
}

/** Plays one visit with `seed`, calling `onFrame(k)` after each 1/30 s step until the visit is done + tail. */
async function play(page, seed, { onFrame, undoAfterMs = 1800, tailMs = 2500, maxMs = 40000 }) {
  await page.evaluate((s) => { window.__pockets.nextSeed = s; document.getElementById('play').click(); }, seed);
  const marks = [];
  let undoRect = null;
  let seen = 0, k = 0, noticeAt = -1, undone = false, doneAt = -1, bubbleFrames = 0;
  while (true) {
    const t0 = Math.round((k * 1000) / FPS), t1 = Math.round(((k + 1) * 1000) / FPS);
    if (k > 0) await page.clock.runFor(t1 - t0);
    await stepAnimations(page, k > 0 ? t1 - t0 : 0);
    const st = await page.evaluate(() => ({
      events: window.__pockets.events.slice(),
      notice: !!window.__pockets.root?.querySelector('.notice:not([hidden])'),
      bubble: !!window.__pockets.root?.querySelector('.bubble:not([hidden])'),
    }));
    for (; seen < st.events.length; seen++) marks.push({ event: st.events[seen], frame: k });
    if (st.bubble) bubbleFrames++;
    if (st.notice && noticeAt < 0) {
      noticeAt = k;
      marks.push({ event: 'notice-visible', frame: k });
    }
    if (noticeAt >= 0 && !undone && (k - noticeAt) * 1000 / FPS >= undoAfterMs) {
      // Where the Undo button is, in CSS px from the mock browser's top left, for the video's pointer.
      undoRect = await page.evaluate(() => {
        const b = document.querySelector('.browser').getBoundingClientRect();
        const f = document.getElementById('page').getBoundingClientRect();
        const u = window.__pockets.root.querySelector('.notice .undo').getBoundingClientRect();
        return { x: f.left - b.left + u.left, y: f.top - b.top + u.top, width: u.width, height: u.height };
      });
      await page.evaluate(() => window.__pockets.root.querySelector('.notice .undo').click());
      marks.push({ event: 'undo-click', frame: k });
      undone = true;
    }
    if (onFrame) await onFrame(k, st);
    if (doneAt < 0 && st.events.includes('done')) doneAt = k;
    if (doneAt >= 0 && (k - doneAt) * 1000 / FPS >= tailMs) break;
    if (k * 1000 / FPS > maxMs) break;
    k++;
  }
  return { marks, frames: k + 1, bubbleFrames, undoRect };
}

const browser = await chromium.launch();
try {
  if (args.scan) {
    const [a, b] = String(args.scan).split('-').map(Number);
    const v = VARIANTS[args.variant ?? 'landscape'];
    const dir = path.join(here, '../out/scan' + (args.page ? `-${args.page}` : ''));
    mkdirSync(dir, { recursive: true });
    for (let s = a; s <= b; s++) {
      const { ctx, page } = await open(browser, v);
      const el = page.locator('.browser');
      const r = await play(page, s, {
        tailMs: 0, undoAfterMs: 1e9,
        onFrame: async (k, st) => { if (k % 30 === 0 && k <= 300) await el.screenshot({ path: path.join(dir, `seed-${s}-${String(k).padStart(3, '0')}.png`), scale: 'css' }); },
      });
      const ev = (n) => r.marks.find((m) => m.event === n)?.frame;
      console.log(`seed ${s}: bubbleFrames=${r.bubbleFrames} card=${ev('card-shown')} take=${ev('take')} done=${ev('done')} total=${r.frames}`);
      await ctx.close();
    }
  } else {
    const seed = Number(args.seed);
    const variant = args.variant ?? 'landscape';
    // --dsf overrides the capture scale (the heist video's tight crops use 3).
    const v = { ...VARIANTS[variant], ...(args.dsf ? { dsf: Number(args.dsf) } : {}) };
    const dir = path.join(here, '../public/footage', String(args.out ?? variant));
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const { ctx, page } = await open(browser, v);
    const el = page.locator('.browser');
    const r = await play(page, seed, {
      onFrame: async (k) => { await el.screenshot({ path: path.join(dir, `f${String(k).padStart(4, '0')}.png`), omitBackground: true }); },
    });
    const box = await el.boundingBox();
    writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ seed, variant, page: args.page ?? 'character', tabs: args.page ? Number(args.tabs ?? 32) : 5, fps: FPS, dsf: v.dsf, frames: r.frames, undoRect: r.undoRect, size: { width: Math.round(box.width * v.dsf), height: Math.round(box.height * v.dsf) }, marks: r.marks }, null, 2));
    console.log(JSON.stringify({ frames: r.frames, bubbleFrames: r.bubbleFrames, marks: r.marks }));
    await ctx.close();
  }
} finally {
  await browser.close();
}
