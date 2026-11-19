// The warning card and the after-theft notice, built inside the stage's shadow root.
// Neither ever calls focus(); their buttons are the only focusable things on the stage, and a hidden card or
// notice is display:none so its button leaves the tab order.
import { CARD_WIDTH, CARD_MARGIN, type CardView } from './sequence';
import { BUBBLE_FONT_PX, BUBBLE_LINE_PX, BUBBLE_MAX_WIDTH, BUBBLE_PAD_X } from './quotes';
import { cleanTitle } from '../shared/title';

/** Styles for everything inside the shadow root. The host itself is reset with `all: initial` in mount.ts. */
export const STAGE_CSS = `
:host{all:initial}
*,*::before,*::after{box-sizing:border-box}
.wrap{--surface:#f8f9fb;--ink:#1c2230;--muted:#5b6474;--line:#cfd4dc;--accent:#c93c30;--ghost:#e4e7ec;
  --shadow:0 6px 24px rgba(20,26,40,.18);
  position:absolute;inset:0;pointer-events:none;overflow:hidden;
  font-family:"DM Sans",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-size:13px;line-height:1.35;color:var(--ink);
  text-align:left;direction:ltr;letter-spacing:normal;text-transform:none;font-style:normal;font-weight:400}
@media (prefers-color-scheme: dark){.wrap{--surface:#1d2128;--ink:#e8ebf0;--muted:#9aa3b2;--line:#343a45;--accent:#ef6a5c;
  --ghost:#2e333c;--shadow:0 6px 24px rgba(0,0,0,.5)}}
canvas{position:absolute;left:0;top:0;pointer-events:none;display:block}
.card,.notice{position:absolute;pointer-events:auto;background:var(--surface);border:1px solid var(--line);border-radius:12px;
  box-shadow:var(--shadow);display:flex;margin:0}
.card[hidden],.notice[hidden]{display:none}
.card{width:min(${CARD_WIDTH}px,calc(100% - ${2 * CARD_MARGIN}px));padding:12px;flex-direction:column;gap:10px;transform-origin:top left;
  animation:pop .2s ease-out}
.card.leaving{animation:fade .15s ease-in forwards;pointer-events:none}
.row{display:flex;gap:10px;align-items:center}
.ring{position:relative;width:40px;height:40px;flex:none}
.ring svg{width:40px;height:40px;transform:rotate(-90deg);display:block}
.ring circle{fill:none;stroke-width:4}
.ring .bg{stroke:var(--ghost)}
.ring .fg{stroke:var(--accent);stroke-linecap:round;stroke-dasharray:100.5;transition:stroke-dashoffset 1s linear}
.ring em{position:absolute;inset:0;display:grid;place-items:center;font-style:normal;font-weight:700;font-size:15px;
  font-variant-numeric:tabular-nums;color:var(--ink)}
.txt{min-width:0;font-size:13px;color:var(--muted);line-height:1.35}
.txt b{display:block;color:var(--ink);font-size:15px;font-weight:700}
.txt span{display:block;overflow-wrap:anywhere}
button{font:inherit;font-size:13px;font-weight:700;border-radius:8px;padding:7px 12px;cursor:pointer;background:transparent;
  color:var(--ink);border:1.5px solid var(--line);margin:0;line-height:1.2}
button:hover{border-color:var(--muted)}
button:focus-visible{outline:2px solid var(--ink);outline-offset:2px}
button[hidden]{display:none}
.notice{right:12px;bottom:12px;max-width:calc(100% - 24px);padding:8px 10px 8px 12px;gap:10px;align-items:center;font-size:13px;
  animation:rise .25s ease-out}
.notice img{width:24px;height:24px;flex:none;display:block}
.notice span{min-width:0;overflow-wrap:anywhere}
.bubble{position:absolute;left:0;top:0;pointer-events:none;width:max-content;max-width:${BUBBLE_MAX_WIDTH}px;
  padding:6px ${BUBBLE_PAD_X}px;background:var(--surface);border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow);
  color:var(--ink);font-size:${BUBBLE_FONT_PX}px;font-weight:500;line-height:${BUBBLE_LINE_PX}px;overflow-wrap:break-word;margin:0;
  animation:pop .18s ease-out}
.bubble[hidden]{display:none}
.bubble::after{content:"";position:absolute;width:10px;height:10px;background:var(--surface);border:1px solid var(--line);transform:rotate(45deg)}
.bubble.down::after{bottom:-6px;border-top:0;border-left:0}
.bubble.up::after{top:-6px;border-bottom:0;border-right:0}
.bubble.east::after{left:14px}
.bubble.west::after{right:14px}
@keyframes pop{from{transform:scale(.9)}to{transform:none}}
@keyframes fade{to{opacity:0;transform:scale(.95)}}
@keyframes rise{from{transform:translateY(12px)}to{transform:none}}
@media (prefers-reduced-motion: reduce){.card,.card.leaving,.notice,.bubble{animation:none}.ring .fg{transition:none}}
`;

const SVG_NS = 'http://www.w3.org/2000/svg';
const RING = 100.5;

/** Keep the page's focus where it is when a stage button is pressed with the mouse. */
function noFocusSteal(b: HTMLButtonElement): void {
  b.addEventListener('mousedown', (e) => e.preventDefault());
}

/** `selector` matches something in `doc`; false where the browser does not know the selector. */
function matches(doc: Document, selector: string): boolean {
  try {
    return doc.querySelector(selector) !== null;
  } catch {
    return false;
  }
}

/** Something in the page's top layer may be painted over the stage: an element other than the stage host is
 *  fullscreen, or a modal dialog or a popover is open. The stage host is an ordinary element, so anything in the
 *  top layer covers it. */
/** The shadow host `el` lives under (the stage host), or null when `el` is in the document itself. */
function shadowHost(el: HTMLElement): Element | null {
  const root = el.getRootNode() as Node & { host?: Element };
  return root !== el.ownerDocument ? root.host ?? null : null;
}

function topLayerCovers(el: HTMLElement): boolean {
  const doc = el.ownerDocument;
  const host = shadowHost(el);
  const fs = doc.fullscreenElement;
  if (fs && fs !== host) return true;
  return matches(doc, 'dialog:modal') || matches(doc, ':popover-open');
}

/** Hit-test the centre of `probe`: the topmost element there must be `el` itself (or, for an element inside a shadow
 *  root such as the stage's, its shadow host: hits inside a closed root are retargeted to the host). This catches
 *  anything painted over it, including elements inside other web components, the top layer and fullscreen.
 *  elementFromPoint skips pointer-events:none, which is why the card has pointer-events:auto. */
function hitIsOurs(el: HTMLElement, probe: HTMLElement): boolean {
  const doc = el.ownerDocument;
  if (typeof doc.elementFromPoint !== 'function') return false;
  const r = probe.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return false;
  const hit = doc.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  if (!hit) return false;
  const host = shadowHost(el);
  return host ? hit === host : hit === el || el.contains(hit);
}

/** Whether `el` is laid out, rendered and inside the viewport of a visible document, with nothing in the top layer
 *  (fullscreen element, modal dialog, popover) that could be painted over it, and with `el` itself (or its shadow host)
 *  topmost at the centre of each probe (default: `el`; the card also probes its Keep button). */
export function onScreen(el: HTMLElement, probes: HTMLElement[] = [el]): boolean {
  const doc = el.ownerDocument;
  const win = doc.defaultView;
  if (!win || doc.visibilityState !== 'visible' || !el.isConnected) return false;
  if (topLayerCovers(el)) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return false;
  if (r.right <= 0 || r.bottom <= 0 || r.left >= win.innerWidth || r.top >= win.innerHeight) return false;
  const check = (el as HTMLElement & { checkVisibility?: (o?: object) => boolean }).checkVisibility;
  if (check && !check.call(el, { opacityProperty: true, visibilityProperty: true })) return false;
  for (const p of probes) if (!hitIsOurs(el, p)) return false;
  return true;
}

export class Card implements CardView {
  readonly el: HTMLDivElement;
  private ringN: HTMLElement;
  private ringFg: SVGCircleElement;
  private title: HTMLElement;
  private sub: HTMLElement;
  private keep: HTMLButtonElement;
  private onKeep: (() => void) | null = null;
  private showToken = 0;
  /** Settles the pending show() with false; hide() and hideNow() call it so cancel never waits on rAF. */
  private settleShow: (() => void) | null = null;
  private leaveTimer = 0;

  constructor(private doc: Document, parent: Node) {
    const el = doc.createElement('div');
    el.className = 'card';
    el.hidden = true;
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    const row = doc.createElement('div');
    row.className = 'row';
    const ring = doc.createElement('div');
    ring.className = 'ring';
    const svg = doc.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 40 40');
    svg.setAttribute('aria-hidden', 'true');
    const circle = (cls: string): SVGCircleElement => {
      const c = doc.createElementNS(SVG_NS, 'circle');
      c.setAttribute('class', cls);
      c.setAttribute('cx', '20');
      c.setAttribute('cy', '20');
      c.setAttribute('r', '16');
      svg.appendChild(c);
      return c;
    };
    circle('bg');
    this.ringFg = circle('fg');
    this.ringN = doc.createElement('em');
    ring.append(svg, this.ringN);
    const txt = doc.createElement('div');
    txt.className = 'txt';
    this.title = doc.createElement('b');
    this.sub = doc.createElement('span');
    txt.append(this.title, this.sub);
    row.append(ring, txt);
    this.keep = doc.createElement('button');
    this.keep.type = 'button';
    this.keep.className = 'keep';
    this.keep.textContent = 'Keep this tab';
    noFocusSteal(this.keep);
    this.keep.addEventListener('click', () => this.onKeep?.());
    el.append(row, this.keep);
    parent.appendChild(el);
    this.el = el;
  }

  show(at: { left: number; top: number }, text: { title: string; sub: string }, onKeep: () => void): Promise<boolean> {
    this.settleShow?.();
    const token = ++this.showToken;
    const win = this.doc.defaultView!;
    win.clearTimeout(this.leaveTimer);
    this.onKeep = onKeep;
    this.title.textContent = text.title;
    this.sub.textContent = text.sub;
    this.ringN.textContent = text.title.match(/\d+/)?.[0] ?? '';
    this.keep.hidden = false;
    this.ringFg.style.transition = 'none';
    this.ringFg.style.strokeDashoffset = '0';
    this.el.classList.remove('leaving');
    this.el.style.left = `${at.left}px`;
    this.el.style.top = `${at.top}px`;
    this.el.hidden = false;
    // Force layout now, then wait for two frames: rAF only runs while the page is visible and the second one
    // comes after the card has been painted. Re-check on every frame until it is really on screen.
    void this.el.getBoundingClientRect();
    return new Promise((resolve) => {
      let settled = false;
      const res = (v: boolean): void => {
        if (settled) return;
        settled = true;
        if (this.settleShow === cancelShow) this.settleShow = null;
        resolve(v);
      };
      const cancelShow = (): void => res(false);
      this.settleShow = cancelShow;
      let frames = 0;
      const step = (): void => {
        if (settled) return;
        if (token !== this.showToken || this.el.hidden) return res(false);
        frames++;
        if (frames >= 2 && this.onScreenNow()) {
          this.ringFg.style.transition = '';
          return res(true);
        }
        win.requestAnimationFrame(step);
      };
      win.requestAnimationFrame(step);
    });
  }

  /** The card's on-screen check: the card and, while it shows, its Keep button must both be uncovered. */
  private onScreenNow(): boolean {
    return onScreen(this.el, this.keep.hidden ? [this.el] : [this.el, this.keep]);
  }

  visible(): boolean {
    return !this.el.hidden && this.onScreenNow();
  }

  count(remaining: number, total: number): void {
    this.ringN.textContent = String(remaining);
    this.title.textContent = `Mine in ${remaining}…`;
    // Drain over this second to where the ring will stand when it ends.
    this.ringFg.style.strokeDashoffset = String(RING * (1 - (remaining - 1) / total));
  }

  kept(title: string, sub: string): void {
    this.onKeep = null;
    this.title.textContent = title;
    this.sub.textContent = sub;
    this.keep.hidden = true;
  }

  hide(): void {
    this.showToken++;
    this.settleShow?.();
    this.onKeep = null;
    if (this.el.hidden) return;
    const reduced = this.doc.defaultView?.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      this.el.hidden = true;
      return;
    }
    this.el.classList.add('leaving');
    this.keep.tabIndex = -1;
    this.doc.defaultView!.clearTimeout(this.leaveTimer);
    this.leaveTimer = this.doc.defaultView!.setTimeout(() => {
      this.el.hidden = true;
      this.el.classList.remove('leaving');
      this.keep.removeAttribute('tabindex');
    }, 150);
  }

  /** Hide at once, without the fade (cancel and destroy). */
  hideNow(): void {
    this.showToken++;
    this.settleShow?.();
    this.onKeep = null;
    this.doc.defaultView?.clearTimeout(this.leaveTimer);
    this.el.hidden = true;
    this.el.classList.remove('leaving');
    this.keep.removeAttribute('tabindex');
  }
}

/** "Pockets took {title}" with Undo, bottom right, for about five seconds. */
export class Notice {
  readonly el: HTMLDivElement;
  private text: HTMLSpanElement;
  private undo: HTMLButtonElement;
  private timer = 0;
  private onUndo: (() => void) | null = null;

  constructor(private doc: Document, parent: Node, iconUrl: string) {
    const el = doc.createElement('div');
    el.className = 'notice';
    el.hidden = true;
    el.setAttribute('role', 'status');
    const img = doc.createElement('img');
    img.src = iconUrl;
    img.alt = '';
    img.draggable = false;
    this.text = doc.createElement('span');
    this.undo = doc.createElement('button');
    this.undo.type = 'button';
    this.undo.className = 'undo';
    this.undo.textContent = 'Undo';
    noFocusSteal(this.undo);
    this.undo.addEventListener('click', () => {
      const cb = this.onUndo;
      this.onUndo = null;
      if (!cb) return;
      cb();
    });
    el.append(img, this.text, this.undo);
    parent.appendChild(el);
    this.el = el;
  }

  show(rawTitle: string, onUndo: () => void): void {
    const title = cleanTitle(rawTitle);
    const win = this.doc.defaultView!;
    win.clearTimeout(this.timer);
    this.text.textContent = `Pockets took ${title}`;
    this.undo.hidden = false;
    this.onUndo = () => {
      this.text.textContent = `${title} is back on the bar.`;
      this.undo.hidden = true;
      onUndo();
      win.clearTimeout(this.timer);
      this.timer = win.setTimeout(() => this.hide(), 2500);
    };
    this.el.hidden = false;
    this.timer = win.setTimeout(() => this.hide(), 5000);
  }

  hide(): void {
    this.doc.defaultView?.clearTimeout(this.timer);
    this.onUndo = null;
    this.el.hidden = true;
  }
}

/** Pockets' speech bubble: never focusable, never in the way of the pointer, hidden from assistive tech (the card
 *  carries everything that matters). mount.ts places it by his head every frame. */
export class Bubble {
  readonly el: HTMLDivElement;
  private size: { w: number; h: number } | null = null;

  constructor(doc: Document, parent: Node) {
    const el = doc.createElement('div');
    el.className = 'bubble down east';
    el.hidden = true;
    el.setAttribute('aria-hidden', 'true');
    parent.appendChild(el);
    this.el = el;
  }

  get shown(): boolean { return !this.el.hidden; }

  say(text: string | null): void {
    if (text === null) { this.hide(); return; }
    this.el.textContent = text;
    // Not painted until place() has put it by Pockets: a stale position must never show.
    this.el.style.visibility = 'hidden';
    this.el.hidden = false;
    this.size = null;
  }

  hide(): void {
    this.el.hidden = true;
    this.size = null;
  }

  /** Put the bubble beside `head` (viewport px): toward the middle of the page, above unless there is no room, and
   *  always inside the viewport. Its tail points back at him. */
  place(head: { x: number; y: number }, width: number, height: number): void {
    if (this.el.hidden) return;
    if (!this.size) this.size = { w: this.el.offsetWidth, h: this.el.offsetHeight };
    const { w, h } = this.size;
    const east = head.x < width / 2;
    let left = east ? head.x + 6 : head.x - 6 - w;
    let top = head.y - 30 - h;
    const up = top < 8;
    if (up) top = head.y + 30;
    left = Math.max(8, Math.min(width - 8 - w, left));
    top = Math.max(8, Math.min(height - 8 - h, top));
    this.el.className = `bubble ${up ? 'up' : 'down'} ${east ? 'east' : 'west'}`;
    // left/top, not transform: the pop animation animates transform and would override it while it runs.
    this.el.style.left = `${Math.round(left)}px`;
    this.el.style.top = `${Math.round(top)}px`;
    this.el.style.visibility = 'visible';
  }
}
