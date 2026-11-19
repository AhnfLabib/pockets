// The character page: plays one visit with the real stage on a mock browser, for the owner to judge.
// Built by scripts/build.mjs into dist/harness/, which embeds the sprite sheets as __POCKETS_SPRITES__.
import { mountStage, type Stage } from '../src/stage/mount';
import type { SpriteMeta, Sprites } from '../src/stage/render';
import type { VisitEvent, VisitPlan } from '../src/shared/types';

declare const __POCKETS_SPRITES__: { meta: SpriteMeta; sheets: string[] };

const ASSETS = '../assets/';
const TABS: { title: string; color: string; active?: boolean }[] = [
  { title: 'Q3 report', color: '#3d7be0', active: true },
  { title: 'Inbox', color: '#d9962f' },
  { title: 'YouTube', color: '#d93a2f' },
  { title: 'Sheet', color: '#2f9d62' },
  { title: 'Flights', color: '#7a5bd0' },
];
const TARGET = 2;

const PAGE_DOC = `<!doctype html><html><head><meta charset="utf-8"><style>
:root{--ink:#1c2230;--ghost:#e4e7ec;--page:#fff}
@media (prefers-color-scheme: dark){:root{--ink:#e8ebf0;--ghost:#2e333c;--page:#20242b}}
html,body{margin:0;height:100%;background:var(--page);color:var(--ink);font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.doc{padding:34px clamp(70px,14%,130px);display:flex;flex-direction:column;gap:12px}
h3{font-size:20px;margin:0 0 6px}
u{display:block;height:10px;border-radius:5px;background:var(--ghost);text-decoration:none}
</style></head><body><div class="doc"><h3>Q3 report draft</h3>${
  [92, 100, 84, 96, 60, 0, 98, 88, 72, 0, 94, 80, 66].map((w) => `<u style="width:${w}%"></u>`).join('')
}</div></body></html>`;

/** A favicon for the target, as the background would pass it, so the carried tab gets its colour. */
const faviconFor = (color: string): string =>
  'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" rx="3" fill="${color}"/></svg>`);

/** What the character page exposes for its e2e test. */
interface HarnessState {
  ready: boolean;
  events: string[];
  root: ShadowRoot | null;
  stage: Stage | null;
  /** The card's rect (iframe viewport px) at the moment card-shown arrived. */
  cardAtShown: { left: number; top: number; width: number; height: number } | null;
  runs: number;
}
const state: HarnessState = { ready: false, events: [], root: null, stage: null, cardAtShown: null, runs: 0 };
(window as unknown as { __pockets: HarnessState }).__pockets = state;

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const strip = $<HTMLDivElement>('strip');
const frame = $<HTMLIFrameElement>('page');
const status = $<HTMLDivElement>('status');
const play = $<HTMLButtonElement>('play');
const playKeep = $<HTMLButtonElement>('playKeep');
const log = $<HTMLSpanElement>('log');

function buildTabs(): void {
  strip.querySelectorAll('.tab').forEach((t) => t.remove());
  const plus = strip.querySelector('.plus');
  TABS.forEach((tab, i) => {
    const el = document.createElement('div');
    el.className = 'tab' + (tab.active ? ' active' : '');
    if (i === TARGET) el.id = 'target';
    const icon = document.createElement('i');
    icon.style.background = tab.color;
    const label = document.createElement('span');
    label.textContent = tab.title;
    el.append(icon, label);
    strip.insertBefore(el, plus);
  });
}

/** Mark the target tab as the extension will: Pockets' icon and a counting-down title. */
function markTarget(remaining: number): void {
  const t = document.getElementById('target');
  if (!t) return;
  t.classList.add('hot');
  if (!t.querySelector('img')) {
    const img = document.createElement('img');
    img.src = ASSETS + 'icons/icon-32.png';
    img.alt = '';
    t.firstElementChild!.replaceWith(img);
  }
  t.querySelector('span')!.textContent = `Mine in ${remaining}…`;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('could not load a sprite sheet'));
    img.src = src;
  });
}

async function start(): Promise<void> {
  buildTabs();
  const loaded = new Promise<void>((res) => frame.addEventListener('load', () => res(), { once: true }));
  frame.srcdoc = PAGE_DOC;
  await loaded;
  const sprites: Sprites = {
    meta: __POCKETS_SPRITES__.meta,
    sheets: await Promise.all(__POCKETS_SPRITES__.sheets.map(loadImage)),
  };
  const stage = await mountStage(frame.contentDocument!, ASSETS, {
    sprites,
    exposeRoot: (root) => { state.root = root; },
  });
  state.stage = stage;
  state.ready = true;
  status.textContent = 'Ready. Pockets will come for the YouTube tab, which has not been opened for two days.';
  play.disabled = false;
  playKeep.disabled = false;
  play.onclick = () => void run(false);
  playKeep.onclick = () => void run(true);
}

async function run(pressKeep: boolean): Promise<void> {
  const stage = state.stage!;
  play.disabled = true;
  playKeep.disabled = true;
  buildTabs();
  state.events = [];
  state.cardAtShown = null;
  state.runs++;
  log.textContent = '';
  status.textContent = 'Pockets pokes its head in at the bottom, looks around and climbs the left border.';
  const plan: VisitPlan = {
    visitId: `harness-${state.runs}`, targetTabId: TARGET, title: TABS[TARGET].title, faviconUrl: faviconFor(TABS[TARGET].color), reason: 'stale',
    reasonText: 'not opened for 2 days', tabIndex: TARGET, tabCount: TABS.length, countdownSeconds: 5, targetIsStage: false,
  };
  const emit = (e: VisitEvent): void => {
    const name = e.type === 'tick' ? `tick ${e.remaining}` : e.type;
    state.events.push(name);
    log.textContent = state.events.join(' · ');
    const target = document.getElementById('target');
    switch (e.type) {
      case 'card-shown': {
        const card = state.root?.querySelector<HTMLElement>('.card');
        const r = card?.getBoundingClientRect();
        if (r) state.cardAtShown = { left: r.left, top: r.top, width: r.width, height: r.height };
        status.textContent = 'Pockets reaches for the tab. The card gives you five seconds to keep it.';
        break;
      }
      case 'tick':
        markTarget(e.remaining);
        if (pressKeep && e.remaining === 3) state.root?.querySelector<HTMLButtonElement>('.keep')?.click();
        break;
      case 'keep':
        buildTabs();
        status.textContent = 'You kept the tab. Pockets leaves empty-pawed.';
        break;
      case 'take':
        // As the background will: close the tab, then tell the stage to show the notice.
        target?.classList.add('gone');
        setTimeout(() => target?.remove(), 300);
        stage.showNotice(TABS[TARGET].title, emit);
        status.textContent = 'The tab drops off the bar. Pockets grabs it and bolts.';
        break;
      case 'undo':
        buildTabs();
        status.textContent = 'Undo: YouTube is back on the bar.';
        break;
      case 'done':
        play.disabled = false;
        playKeep.disabled = false;
        if (!pressKeep && !status.textContent?.startsWith('Undo')) status.textContent += ' Press Undo on the notice to bring it back.';
        break;
    }
  };
  await stage.play(plan, emit);
}

void start().catch((err: unknown) => {
  status.textContent = `Could not start: ${String(err)}`;
  throw err;
});
