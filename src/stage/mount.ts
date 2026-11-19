// The stage: a closed shadow root on a fixed, full-viewport host that ignores the pointer, holding the canvas
// Pockets is drawn on, the warning card and the notice. Page CSS cannot reach inside, and the host is reset
// with `all: initial` plus important inline styles so page rules cannot hide or move it.
import { Rig } from './rig/rig';
import type { Pt } from './rig/chain';
import { drawPose, loadSprites, type Sprites } from './render';
import { Card, Notice, STAGE_CSS } from './card';
import { runVisit, type Carry } from './sequence';
import type { VisitEvent, VisitPlan } from '../shared/types';

export { estimateTabX } from './sequence';

export interface Stage {
  play(plan: VisitPlan, emit: (e: VisitEvent) => void): Promise<void>;
  showNotice(title: string, emit: (e: VisitEvent) => void): void;
  cancel(): void;
  destroy(): void;
}

export interface StageOptions {
  /** Randomness for the rig and the path jitter. Defaults to Math.random. */
  rand?: () => number;
  /** Sprites already loaded. Without it they are loaded from `assetBase + 'sprites/'`. */
  sprites?: Sprites;
  /** Hands over the closed shadow root. For the character page and its e2e test only. */
  exposeRoot?: (root: ShadowRoot) => void;
}

const HOST_STYLE: Record<string, string> = {
  all: 'initial',
  position: 'fixed',
  left: '0',
  top: '0',
  right: '0',
  bottom: '0',
  width: '100vw',
  height: '100vh',
  display: 'block',
  margin: '0',
  padding: '0',
  border: '0',
  'z-index': '2147483647',
  'pointer-events': 'none',
  overflow: 'hidden',
  contain: 'strict',
  visibility: 'visible',
  opacity: '1',
  transform: 'none',
  filter: 'none',
};

const TAB_COLORS = ['#d93a2f', '#3d7be0', '#2f9d62', '#d9962f', '#7a5bd0', '#1f8a9e'];
const INK = '#23252d';

/** A stable colour for a tab's little favicon square, picked from its title. */
export function faviconColorFor(title: string): string {
  let h = 0;
  for (let i = 0; i < title.length; i++) h = (h * 31 + title.charCodeAt(i)) >>> 0;
  return TAB_COLORS[h % TAB_COLORS.length];
}

/**
 * The favicon's main colour, when the image can be read (same-origin or data: URLs). Cross-origin favicons
 * taint the canvas, so those, and failures, resolve null and the title's colour is used instead.
 */
export function readFaviconColor(win: Window, url: string | undefined): Promise<string | null> {
  if (!url) return Promise.resolve(null);
  return new Promise((res) => {
    const img = win.document.createElement('img');
    const timer = win.setTimeout(() => res(null), 800);
    img.onerror = () => {
      win.clearTimeout(timer);
      res(null);
    };
    img.onload = () => {
      win.clearTimeout(timer);
      try {
        const c = win.document.createElement('canvas');
        c.width = 16;
        c.height = 16;
        const g = c.getContext('2d')!;
        g.drawImage(img, 0, 0, 16, 16);
        const d = g.getImageData(0, 0, 16, 16).data;
        let r = 0;
        let gr = 0;
        let b = 0;
        let n = 0;
        for (let i = 0; i < d.length; i += 4) {
          const max = Math.max(d[i], d[i + 1], d[i + 2]);
          const min = Math.min(d[i], d[i + 1], d[i + 2]);
          if (d[i + 3] < 128 || max - min < 40) continue; // skip transparent, white, black and grey
          r += d[i];
          gr += d[i + 1];
          b += d[i + 2];
          n++;
        }
        res(n ? `rgb(${Math.round(r / n)},${Math.round(gr / n)},${Math.round(b / n)})` : null);
      } catch {
        res(null);
      }
    };
    img.src = url;
  });
}

/** Where the carried tab hangs, as render.ts places it: 22 px ahead of the head pivot along the head angle. */
function mouthOf(pose: ReturnType<Rig['pose']>): { p: Pt; angle: number } {
  const n = pose.nodes;
  const fx = n[0].x - n[1].x;
  const fy = n[0].y - n[1].y;
  const l = Math.hypot(fx, fy) || 1;
  const ha = Math.atan2(fy, fx) + pose.headAngle;
  const hx = n[0].x - (fx / l) * 10 + Math.cos(ha) * 10;
  const hy = n[0].y - (fy / l) * 10 + Math.sin(ha) * 10;
  return { p: { x: hx + Math.cos(ha) * 22, y: hy + Math.sin(ha) * 22 }, angle: ha + Math.PI / 2 };
}

/** The tab falling from the bar into Pockets' mouth (the same look as render.ts's carried tab). */
function drawFallingTab(ctx: CanvasRenderingContext2D, at: Pt, angle: number, title: string, color: string): void {
  ctx.save();
  ctx.translate(at.x, at.y);
  ctx.rotate(angle);
  ctx.font = '500 10px "DM Sans", sans-serif';
  let t = title;
  if (ctx.measureText(t).width > 110) {
    while (t.length > 1 && ctx.measureText(t + '…').width > 110) t = t.slice(0, -1);
    t += '…';
  }
  const w = Math.max(62, 26 + ctx.measureText(t).width);
  ctx.shadowColor = 'rgba(0,0,0,0.22)';
  ctx.shadowBlur = 7;
  ctx.shadowOffsetY = 3;
  ctx.fillStyle = '#fbfaf5';
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.roundRect(-w / 2, -9, w, 18, [6, 6, 0, 0]);
  ctx.fill();
  ctx.shadowColor = 'rgba(0,0,0,0)';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(-w / 2 + 6, -5, 10, 10, 2);
  ctx.fill();
  ctx.fillStyle = '#1c2230';
  ctx.textBaseline = 'middle';
  ctx.fillText(t, -w / 2 + 20, 0.5);
  ctx.restore();
}

/**
 * Mount the stage on `host` (the page's document). `assetBase` ends in '/' and holds sprites/ and icons/.
 * Resolves once the sprites are loaded.
 */
export async function mountStage(host: Document, assetBase: string, opts: StageOptions = {}): Promise<Stage> {
  const win = host.defaultView;
  if (!win) throw new Error('Pockets: the stage needs a document with a window');
  const rand = opts.rand ?? Math.random;
  const sprites = opts.sprites ?? (await loadSprites(assetBase + 'sprites/'));

  const el = host.createElement('pockets-stage');
  for (const [k, v] of Object.entries(HOST_STYLE)) el.style.setProperty(k, v, 'important');
  const root = el.attachShadow({ mode: 'closed' });
  const style = host.createElement('style');
  style.textContent = STAGE_CSS;
  const wrap = host.createElement('div');
  wrap.className = 'wrap';
  const canvas = host.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  wrap.appendChild(canvas);
  root.append(style, wrap);
  const card = new Card(host, wrap);
  const notice = new Notice(host, wrap, assetBase + 'icons/icon-32.png');
  (host.documentElement ?? host.body).appendChild(el);
  opts.exposeRoot?.(root);

  const ctx = canvas.getContext('2d')!;
  let W = 0;
  let H = 0;
  let dpr = 1;
  const size = (): void => {
    dpr = win.devicePixelRatio || 1;
    W = win.innerWidth;
    H = win.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
  };
  size();
  win.addEventListener('resize', size);

  // One visit at a time.
  let rig: Rig | null = null;
  let visible = false;
  let carry: (Carry & { at: number }) | null = null;
  let title = '';
  let color = '';
  let reduced = false;
  let abort: AbortController | null = null;
  let raf = 0;
  let last = 0;
  let t = 0;

  const frame = (ts: number): void => {
    raf = 0;
    const dt = last ? Math.min(0.05, (ts - last) / 1000) : 0;
    last = ts;
    if (rig && !reduced) {
      rig.update(dt);
      t += dt;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (rig && visible) {
      const pose = rig.pose();
      const held = carry?.phase === 'held' ? { title, faviconColor: color } : undefined;
      drawPose(ctx, pose, sprites, t, held);
      if (carry?.phase === 'drop') {
        const k = Math.min(1, (ts - carry.at) / carry.ms);
        const e = k * k;
        const m = mouthOf(pose);
        const at = { x: carry.from.x + (m.p.x - carry.from.x) * e, y: carry.from.y + (m.p.y - carry.from.y) * e };
        drawFallingTab(ctx, at, m.angle * e, title, color);
      }
    }
    if (rig) raf = win.requestAnimationFrame(frame);
  };
  const startLoop = (): void => {
    if (!raf) {
      last = 0;
      raf = win.requestAnimationFrame(frame);
    }
  };
  const stopLoop = (): void => {
    if (raf) win.cancelAnimationFrame(raf);
    raf = 0;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  const cancel = (): void => {
    abort?.abort();
    abort = null;
    void rig?.travel([], 0);
    rig = null;
    visible = false;
    carry = null;
    card.hideNow();
    stopLoop();
  };

  return {
    async play(plan, emit) {
      cancel();
      size();
      const ac = new AbortController();
      abort = ac;
      reduced = win.matchMedia('(prefers-reduced-motion: reduce)').matches;
      title = plan.title;
      color = faviconColorFor(plan.title);
      void readFaviconColor(win, plan.faviconUrl).then((c) => {
        if (c && abort === ac) color = c;
      });
      t = 0;
      try {
        await runVisit(plan, emit, {
          createRig: (start, heading) => {
            rig = new Rig({ start, heading, rand, still: reduced });
            startLoop();
            return rig;
          },
          card,
          view: { width: W, height: H },
          reduced,
          rand,
          signal: ac.signal,
          setCarry: (c) => {
            carry = c ? { ...c, at: win.performance.now() } : null;
          },
          setVisible: (on) => {
            visible = on;
          },
        });
      } finally {
        if (abort === ac) {
          abort = null;
          rig = null;
          visible = false;
          carry = null;
          stopLoop();
        }
      }
    },
    showNotice(noticeTitle, emit) {
      notice.show(noticeTitle, () => emit({ type: 'undo' }));
    },
    cancel,
    destroy() {
      cancel();
      notice.hide();
      win.removeEventListener('resize', size);
      el.remove();
    },
  };
}
