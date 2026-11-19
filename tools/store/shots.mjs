// Makes the Chrome Web Store images into docs/store/. Run: npm run build && node tools/store/shots.mjs
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = (n) => path.join(root, 'docs/store', n);
const url = (p) => pathToFileURL(path.join(root, p)).href;
const BG = '#eceef2';

// Headline above a full-width mock browser, injected over the character page (real stage underneath).
const FRAME_CSS = (headline) => `
html,body{width:1280px;height:800px;overflow:hidden;background:${BG}}
.wrap{max-width:none;width:1280px;padding:0 40px;gap:0;display:block}
.hero,.controls,.notes,.log{display:none!important}
.hl{height:170px;display:flex;align-items:center;font-size:44px;line-height:1.1;font-weight:800;color:#1c2230;letter-spacing:-.01em;padding:0 8px}
.browser{width:1200px;box-shadow:0 14px 40px rgba(28,34,48,.22)}
#page{height:526px!important}
.status{display:none}`;

async function frameShot(browser, headline, file, when) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, colorScheme: 'light' });
  await page.goto(url('dist-harness/character.html'));
  await page.waitForFunction(() => window.__pockets.ready);
  await page.addStyleTag({ content: FRAME_CSS(headline) });
  await page.evaluate((h) => {
    const d = document.createElement('div'); d.className = 'hl'; d.textContent = h;
    document.querySelector('.wrap').prepend(d);
  }, headline);
  await page.evaluate(() => document.getElementById('play').click());
  await when(page);
  await page.screenshot({ path: file });
  await page.close();
}
const events = (p) => p.evaluate(() => window.__pockets.events.join(','));
const waitEvent = (p, re, t = 30000) => p.waitForFunction((s) => new RegExp(s).test(window.__pockets.events.join(',')), re.source, { timeout: t });

const browser = await chromium.launch();

// 1: climbing the left border, before the card (fixed wait, checked by eye).
await frameShot(browser, 'Leave a tab alone too long and Pockets comes for it.', out('screenshot-1-climb.png'),
  async (p) => { await p.waitForTimeout(Number(process.env.CLIMB_MS ?? 5200)); });

// 2: the card at "Mine in 3…", with the tab title counting down.
await frameShot(browser, "Five seconds' warning. Keep it, or lose it.", out('screenshot-2-countdown.png'),
  async (p) => { await waitEvent(p, /tick 3/); await p.waitForTimeout(450); });

// 3: after the take, the "Pockets took YouTube" notice with Undo, as he runs off.
await frameShot(browser, 'He takes it and runs. Undo if you change your mind.', out('screenshot-3-getaway.png'),
  async (p) => {
    await waitEvent(p, /take/);
    await p.waitForFunction(() => !!window.__pockets.root?.querySelector('.undo,button[class*="undo" i]'), null, { timeout: 15000 }).catch(() => {});
    await p.waitForTimeout(Number(process.env.GETAWAY_MS ?? 800));
  });

// 4: the popup, with chrome.* stubbed: working mode on, three taken tabs.
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, colorScheme: 'light' });
  await ctx.addInitScript(() => {
    const now = Date.now();
    const db = {
      runtime: { working: true, workingSince: now - 3600e3 },
      settings: {},
      taken: [
        { title: 'Flight deals', url: 'https://www.kayak.com/flights', takenAt: now - 2 * 60e3, reason: 'stale' },
        { title: 'Reddit — r/pics', url: 'https://www.reddit.com/r/pics', takenAt: now - 14 * 60e3, reason: 'distracting' },
        { title: 'YouTube', url: 'https://www.youtube.com/watch?v=x', takenAt: now - 41 * 60e3, reason: 'distracting' },
      ],
    };
    const pick = (k) => (typeof k === 'string' ? { [k]: db[k] } : Object.fromEntries(Object.keys(k ?? db).map((x) => [x, db[x]])));
    window.chrome = {
      storage: { local: { get: async (k) => pick(k), set: async (o) => { Object.assign(db, o); } } },
      runtime: { sendMessage: async () => ({ ok: true }), openOptionsPage: async () => {} },
      tabs: { query: async () => [{ url: 'https://news.ycombinator.com/' }] },
      action: {},
    };
  });
  const page = await ctx.newPage();
  await page.goto(url('tools/store/popup.html'));
  await page.frameLocator('iframe').locator('li[data-taken]').first().waitFor();
  await page.waitForTimeout(300);
  await page.screenshot({ path: out('screenshot-4-popup.png') });
  await ctx.close();
}

// Promo tile 440x280.
{
  const page = await browser.newPage({ viewport: { width: 440, height: 280 }, deviceScaleFactor: 1 });
  await page.setContent(`<style>html,body{margin:0;width:440px;height:280px;background:#c93c30;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;overflow:hidden}
  body{display:flex;align-items:center;gap:16px;padding:0 24px;box-sizing:border-box;color:#fff}
  img{width:150px;height:150px;flex:none;border-radius:28px;background:#f8f9fb;padding:8px;box-sizing:border-box}
  h1{margin:0;font-size:50px;line-height:1;font-weight:800;letter-spacing:-.02em}p{margin:8px 0 0;font-size:21px;line-height:1.2;font-weight:500}</style>
  <img src="data:image/png;base64,${readFileSync(path.join(root, 'assets/icons/icon-128.png')).toString('base64')}" alt=""><div><h1>Pockets</h1><p>the tab-stealing raccoon</p></div>`);
    await page.screenshot({ path: out('promo-440x280.png') });
  await page.close();
}
await browser.close();

// Flatten to opaque RGB.
execFileSync('python3', ['-c', `
import glob
from PIL import Image
for f in glob.glob(${JSON.stringify(out('*.png'))}):
    im = Image.open(f)
    bg = Image.new('RGB', im.size, (255, 255, 255))
    bg.paste(im.convert('RGBA'), mask=im.convert('RGBA').split()[3])
    bg.save(f)
`]);
