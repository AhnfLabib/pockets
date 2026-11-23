// Captures the extension's real toolbar popup (dist/popup.html) with chrome.* stubbed, the same stub as
// tools/store/shots.mjs: frame 0 with working mode off, then the switch is clicked and the switch's CSS
// transition is stepped one video frame (1/30 s) at a time. Run from tools/promo-video after `npm run build`.
// Flags (heist video): --scheme dark captures the popup's dark theme; --out names the folder under public/ (default popup).
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
const dir = path.join(here, '../public', String(args.out ?? 'popup'));
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 320, height: 600 }, deviceScaleFactor: 3, colorScheme: args.scheme === 'dark' ? 'dark' : 'light' });
await ctx.addInitScript(() => {
  const now = Date.now();
  const db = {
    runtime: { working: false },
    settings: {},
    taken: [
      { title: 'Flight deals', url: 'https://www.kayak.com/flights', takenAt: now - 2 * 60e3, reason: 'stale' },
      { title: 'Reddit — r/pics', url: 'https://www.reddit.com/r/pics', takenAt: now - 14 * 60e3, reason: 'distracting' },
      { title: 'YouTube', url: 'https://www.youtube.com/watch?v=x', takenAt: now - 41 * 60e3, reason: 'distracting' },
    ],
  };
  const pick = (k) => (typeof k === 'string' ? { [k]: db[k] } : Object.fromEntries(Object.keys(k ?? db).map((x) => [x, db[x]])));
  window.chrome = {
    storage: { local: { get: async (k) => pick(k), set: async (o) => { Object.assign(db, o); } }, onChanged: { addListener() {} } },
    runtime: { sendMessage: async () => ({ ok: true }), openOptionsPage: async () => {} },
    tabs: { query: async () => [{ url: 'https://www.youtube.com/' }] },
    action: {},
  };
});
const page = await ctx.newPage();
await page.goto(pathToFileURL(path.join(root, 'dist/popup.html')).href);
await page.locator('li[data-taken]').first().waitFor();
await page.waitForTimeout(400);
const height = await page.evaluate(() => Math.ceil(document.documentElement.getBoundingClientRect().height));
const clip = { x: 0, y: 0, width: 320, height };
// Where the switch is, in CSS px, for the video's pointer.
const switchRect = await page.evaluate(() => {
  const r = (document.querySelector('label.switch') ?? document.getElementById('working')).getBoundingClientRect();
  return { x: r.left, y: r.top, width: r.width, height: r.height };
});
const shot = (k) => page.screenshot({ path: path.join(dir, `p${String(k).padStart(3, '0')}.png`), clip });
await shot(0);
await page.evaluate(() => { document.getElementById('working').click(); });
const FRAMES = 12;
for (let k = 1; k <= FRAMES; k++) {
  await page.evaluate((t) => {
    for (const a of document.getAnimations()) { a.pause(); a.currentTime = t; }
  }, Math.round((k * 1000) / 30));
  await shot(k);
}
writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ frames: FRAMES + 1, dsf: 3, switchRect, size: { width: 320 * 3, height: height * 3 } }, null, 2));
console.log({ height, frames: FRAMES + 1, switchRect });
await browser.close();
