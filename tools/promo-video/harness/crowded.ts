// A variant of the character page (harness/character.ts at the repository root) for the intro video's hook: the
// same real stage, rig and card, on a mock browser crammed with dozens of tabs. Nothing in the extension or its
// harness changes; this page only builds a different tab strip and passes the matching tabIndex/tabCount.
// Built by capture/build-harness.mjs into tools/promo-video/.harness/. Query: ?tabs=32&target=12
import { mountStage, type Stage } from '../../../src/stage/mount';
import { loadSprites, type SpriteData } from '../../../src/stage/render';
import type { VisitEvent, VisitPlan } from '../../../src/shared/types';

declare const __POCKETS_SPRITES__: SpriteData;
declare const __POCKETS_ASSETS__: string;

const ASSETS = __POCKETS_ASSETS__;
const q = new URLSearchParams(location.search);
const COUNT = Math.max(5, Math.min(80, Number(q.get('tabs') ?? 32)));
const TARGET = Math.max(1, Math.min(COUNT - 1, Number(q.get('target') ?? 12)));
const ACTIVE = 0;

// Favicon colours for a believable mess of sites; the target is YouTube red.
const PALETTE = ['#3d7be0', '#d9962f', '#2f9d62', '#7a5bd0', '#1c2230', '#e0663d', '#2a9bb5', '#c2417a', '#6b7a8f', '#4f8f2f', '#b5852a', '#5b4bd6'];
const TITLES = ['Q3 report', 'Inbox', 'Sheet', 'Flights', 'Docs', 'Recipe', 'Maps', 'News', 'Wiki', 'Shop', 'Calendar', 'Slides', 'Forum', 'Blog', 'Hotels', 'Tickets'];
const TABS = Array.from({ length: COUNT }, (_, i) =>
  i === TARGET ? { title: 'YouTube', color: '#d93a2f' } : { title: TITLES[i % TITLES.length], color: PALETTE[(i * 5 + 3) % PALETTE.length] },
);

const PAGE_DOC = `<!doctype html><html><head><meta charset="utf-8"><style>
:root{--ink:#1c2230;--ghost:#e4e7ec;--page:#fff}
html,body{margin:0;height:100%;background:var(--page);color:var(--ink);font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.doc{padding:34px clamp(70px,14%,130px);display:flex;flex-direction:column;gap:12px}
h3{font-size:20px;margin:0 0 6px}
u{display:block;height:10px;border-radius:5px;background:var(--ghost);text-decoration:none}
</style></head><body><div class="doc"><h3>Q3 report draft</h3>${
  [92, 100, 84, 96, 60, 0, 98, 88, 72, 0, 94, 80, 66, 0, 90, 76].map((w) => `<u style="width:${w}%"></u>`).join('')
}</div></body></html>`;

const faviconFor = (color: string): string =>
  'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" rx="3" fill="${color}"/></svg>`);

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}
let current = mulberry(1);

interface HarnessState {
  seed: number; nextSeed: number | null; ready: boolean; events: string[];
  root: ShadowRoot | null; stage: Stage | null; runs: number;
}
const state: HarnessState = { seed: 0, nextSeed: null, ready: false, events: [], root: null, stage: null, runs: 0 };
(window as unknown as { __pockets: HarnessState }).__pockets = state;

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const strip = $<HTMLDivElement>('strip');
const frame = $<HTMLIFrameElement>('page');
const play = $<HTMLButtonElement>('play');

function buildTabs(): void {
  strip.querySelectorAll('.tab').forEach((t) => t.remove());
  const plus = strip.querySelector('.plus');
  TABS.forEach((tab, i) => {
    const el = document.createElement('div');
    el.className = 'tab' + (i === ACTIVE ? ' active' : '');
    if (i === TARGET) el.id = 'target';
    const icon = document.createElement('i');
    icon.style.background = tab.color;
    const label = document.createElement('span');
    label.textContent = tab.title;
    el.append(icon, label);
    strip.insertBefore(el, plus);
  });
}

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

async function start(): Promise<void> {
  buildTabs();
  const loaded = new Promise<void>((res) => frame.addEventListener('load', () => res(), { once: true }));
  frame.srcdoc = PAGE_DOC;
  await loaded;
  const sprites = await loadSprites(__POCKETS_SPRITES__);
  const stage = await mountStage(frame.contentDocument!, {
    sprites,
    rand: () => current(),
    iconUrl: ASSETS + 'icons/icon-32.png',
    exposeRoot: (root) => { state.root = root; },
  });
  state.stage = stage;
  state.ready = true;
  play.disabled = false;
  play.onclick = () => void run();
}

async function run(): Promise<void> {
  const stage = state.stage!;
  play.disabled = true;
  buildTabs();
  state.events = [];
  state.runs++;
  state.seed = state.nextSeed ?? crypto.getRandomValues(new Uint32Array(1))[0];
  state.nextSeed = null;
  current = mulberry(state.seed);
  const plan: VisitPlan = {
    visitId: `intro-${state.runs}`, targetTabId: TARGET, title: TABS[TARGET].title, faviconUrl: faviconFor(TABS[TARGET].color), reason: 'stale',
    reasonText: 'not opened for 2 days', tabIndex: TARGET, tabCount: TABS.length, countdownSeconds: 5, targetIsStage: false,
  };
  const emit = (e: VisitEvent): void => {
    state.events.push(e.type === 'tick' ? `tick ${e.remaining}` : e.type);
    const target = document.getElementById('target');
    switch (e.type) {
      case 'tick': markTarget(e.remaining); break;
      case 'keep': buildTabs(); break;
      case 'take':
        target?.classList.add('gone');
        setTimeout(() => target?.remove(), 300);
        stage.showNotice(TABS[TARGET].title, emit);
        break;
      case 'undo': buildTabs(); break;
      case 'done': play.disabled = false; break;
    }
  };
  await stage.play(plan, emit);
}

void start();
