// @vitest-environment jsdom
// The real warning card in jsdom: what counts as "on screen", and how that gates card-shown and take.
// jsdom lays nothing out (every rect is zero), so each test stubs the card's rect; every "not on screen" case has a
// positive control in the same setup, so a pass cannot come from jsdom alone.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Card, onScreen } from '../../src/stage/card';
import { runVisit, type RigLike } from '../../src/stage/sequence';
import type { VisitEvent, VisitPlan } from '../../src/shared/types';

const plan = (over: Partial<VisitPlan> = {}): VisitPlan => ({
  visitId: 'v1', targetTabId: 7, title: 'Old page', reason: 'stale', reasonText: 'not opened for 2 days',
  tabIndex: 1, tabCount: 3, countdownSeconds: 3, targetIsStage: false, ...over,
});

const types = (events: VisitEvent[]): string[] => events.map((e) => (e.type === 'tick' ? `tick ${e.remaining}` : e.type));

/** What the page has in its top layer, read by the stubs below. */
let modal = false;
let popover = false;
let fullscreen: Element | null = null;
let modalThrows = false;
/** What document.elementFromPoint answers (jsdom has none). Default: the stage host, i.e. nothing covers the card. */
let hitAt: (x: number, y: number) => Element | null = () => host;
const hits: [number, number][] = [];

let host: HTMLElement;
let card: Card;

function rect(): DOMRect {
  return { left: 12, top: 70, right: 262, bottom: 170, width: 250, height: 100, x: 12, y: 70, toJSON: () => ({}) } as DOMRect;
}

beforeEach(() => {
  modal = false;
  popover = false;
  fullscreen = null;
  modalThrows = false;
  document.body.innerHTML = '';
  host = document.createElement('pockets-stage');
  const root = host.attachShadow({ mode: 'closed' });
  document.body.appendChild(host);
  card = new Card(document, root);
  card.el.getBoundingClientRect = rect;
  // Keep is the card's last row: 12..262 x 133..164, centred at (137, 148.5).
  keepButton().getBoundingClientRect = () =>
    ({ left: 12, top: 133, right: 262, bottom: 164, width: 250, height: 31, x: 12, y: 133, toJSON: () => ({}) } as DOMRect);
  hitAt = () => host;
  hits.length = 0;
  (document as unknown as { elementFromPoint: (x: number, y: number) => Element | null }).elementFromPoint = (x, y) => {
    hits.push([x, y]);
    return hitAt(x, y);
  };
  const realQuery = document.querySelector.bind(document);
  vi.spyOn(document, 'querySelector').mockImplementation(((sel: string) => {
    if (sel === 'dialog:modal') {
      if (modalThrows) throw new SyntaxError('unknown pseudo-class');
      return modal ? document.createElement('dialog') : null;
    }
    if (sel === ':popover-open') return popover ? document.createElement('div') : null;
    return realQuery(sel);
  }) as typeof document.querySelector);
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fullscreen });
  // jsdom has no matchMedia; the card asks it for prefers-reduced-motion when it hides.
  window.matchMedia = ((q: string) => ({ matches: false, media: q })) as unknown as typeof window.matchMedia;
});

const keepButton = (): HTMLButtonElement => (card as unknown as { keep: HTMLButtonElement }).keep;

afterEach(() => {
  vi.restoreAllMocks();
  delete (document as { elementFromPoint?: unknown }).elementFromPoint;
  delete (document as { fullscreenElement?: unknown }).fullscreenElement;
});

describe('onScreen', () => {
  it('is true for a laid-out card inside the viewport with nothing in the top layer (control)', () => {
    card.el.hidden = false;
    expect(onScreen(card.el)).toBe(true);
  });

  it('is false while a modal dialog is open', () => {
    card.el.hidden = false;
    expect(onScreen(card.el)).toBe(true);
    modal = true;
    expect(onScreen(card.el)).toBe(false);
  });

  it('is false while a popover is open', () => {
    card.el.hidden = false;
    expect(onScreen(card.el)).toBe(true);
    popover = true;
    expect(onScreen(card.el)).toBe(false);
  });

  it('is false while an element other than the stage host is fullscreen', () => {
    card.el.hidden = false;
    expect(onScreen(card.el)).toBe(true);
    fullscreen = document.createElement('video');
    expect(onScreen(card.el)).toBe(false);
    fullscreen = document.documentElement;
    expect(onScreen(card.el)).toBe(false);
  });

  it('is true while the stage host itself is fullscreen', () => {
    card.el.hidden = false;
    fullscreen = host;
    expect(onScreen(card.el)).toBe(true);
  });

  it('a browser without :modal does not break the check', () => {
    card.el.hidden = false;
    modalThrows = true;
    expect(onScreen(card.el)).toBe(true);
    popover = true;
    expect(onScreen(card.el)).toBe(false);
  });
});

describe('onScreen hit test', () => {
  it('uncovered: on screen, after hit-testing the centres of the card and of the Keep button', () => {
    card.el.hidden = false;
    expect(card.visible()).toBe(true);
    expect(hits).toEqual([[137, 120], [137, 148.5]]);
  });

  it('a page element painted over the card centre: not on screen', () => {
    card.el.hidden = false;
    expect(card.visible()).toBe(true);
    const cover = document.createElement('div');
    document.body.appendChild(cover);
    hitAt = (_x, y) => (y === 120 ? cover : host);
    expect(card.visible()).toBe(false);
  });

  it('an element inside another component\'s open shadow root over the card: not on screen', () => {
    card.el.hidden = false;
    expect(card.visible()).toBe(true);
    // The browser retargets a hit inside a shadow root to that root's host: the component, not our stage.
    const component = document.createElement('x-overlay');
    const inner = component.attachShadow({ mode: 'open' });
    inner.appendChild(document.createElement('div'));
    document.body.appendChild(component);
    hitAt = () => component;
    expect(card.visible()).toBe(false);
  });

  it('only the Keep button covered: not on screen', () => {
    card.el.hidden = false;
    const cover = document.createElement('div');
    hitAt = (_x, y) => (y === 148.5 ? cover : host);
    expect(card.visible()).toBe(false);
  });

  it('nothing at the point (outside the viewport), or no elementFromPoint at all: not on screen', () => {
    card.el.hidden = false;
    hitAt = () => null;
    expect(card.visible()).toBe(false);
    delete (document as { elementFromPoint?: unknown }).elementFromPoint;
    expect(card.visible()).toBe(false);
  });

  it('once kept (Keep hidden), only the card centre is probed', () => {
    card.el.hidden = false;
    card.kept('Fine. Keep it.', 'x');
    hits.length = 0;
    expect(card.visible()).toBe(true);
    expect(hits).toEqual([[137, 120]]);
  });
});

describe('runVisit with the real card', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const rig = (): RigLike => ({ travel: async () => true, setLook() {}, setReach() {}, setStretch() {} });

  function play(onEvent: (e: VisitEvent) => void = () => {}) {
    const events: VisitEvent[] = [];
    const ac = new AbortController();
    let resolved = false;
    const p = runVisit(plan(), (e) => { events.push(e); onEvent(e); }, {
      createRig: rig, card, view: { width: 1024, height: 768 }, reduced: false, rand: () => 0.5, signal: ac.signal, setCarry: () => {},
    }).then(() => { resolved = true; });
    return { events, ac, p, resolved: () => resolved };
  }

  it('control: with nothing in the top layer the visit runs to take and done', async () => {
    const v = play();
    await vi.advanceTimersByTimeAsync(30_000);
    await v.p;
    expect(types(v.events).filter((t) => t !== 'alive')).toEqual(['card-shown', 'tick 3', 'tick 2', 'tick 1', 'take', 'done']);
  });

  it('a modal dialog open when the card should show: no card-shown; it waits, then gives up with hidden after 10 s', async () => {
    modal = true;
    const v = play();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(types(v.events)).not.toContain('card-shown');
    expect(v.resolved(), 'still waiting inside the 10 s window').toBe(false);
    await vi.advanceTimersByTimeAsync(30_000);
    await v.p;
    expect(types(v.events).filter((x) => x !== 'alive')).toEqual(['hidden']);
    expect(card.el.hidden).toBe(true);
  });

  it('a modal dialog open when the card should show, then aborted inside the window: nothing emitted', async () => {
    modal = true;
    const v = play();
    await vi.advanceTimersByTimeAsync(5_000);
    v.ac.abort();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(v.resolved()).toBe(true);
    expect(types(v.events).filter((x) => x !== 'alive')).toEqual([]);
  });

  it('an element fullscreen when the card should show: no card-shown, hidden after 10 s', async () => {
    fullscreen = document.createElement('video');
    const v = play();
    await vi.advanceTimersByTimeAsync(30_000);
    await v.p;
    expect(types(v.events).filter((x) => x !== 'alive')).toEqual(['hidden']);
  });

  it('a modal dialog that opens after card-shown, before the countdown ends: hidden, never take, no done', async () => {
    const v = play((e) => { if (e.type === 'tick' && e.remaining === 2) modal = true; });
    await vi.advanceTimersByTimeAsync(30_000);
    await v.p;
    const t = types(v.events).filter((x) => x !== 'alive');
    expect(t).toEqual(['card-shown', 'tick 3', 'tick 2', 'tick 1', 'hidden']);
    expect(t).not.toContain('take');
    expect(card.el.hidden).toBe(true);
  });

  it('an element that goes fullscreen after card-shown: hidden, never take', async () => {
    const v = play((e) => { if (e.type === 'tick' && e.remaining === 1) fullscreen = document.body; });
    await vi.advanceTimersByTimeAsync(30_000);
    await v.p;
    expect(types(v.events).filter((x) => x !== 'alive')).toEqual(['card-shown', 'tick 3', 'tick 2', 'tick 1', 'hidden']);
  });

  it('a covering element (no modal, popover or fullscreen) present when the card should show: no card-shown, hidden', async () => {
    const cover = document.createElement('div');
    hitAt = () => cover;
    const v = play();
    await vi.advanceTimersByTimeAsync(30_000);
    await v.p;
    expect(types(v.events).filter((x) => x !== 'alive')).toEqual(['hidden']);
  });

  it('a covering element that appears after card-shown: hidden, never take', async () => {
    const component = document.createElement('x-overlay');
    const v = play((e) => { if (e.type === 'tick' && e.remaining === 2) hitAt = () => component; });
    await vi.advanceTimersByTimeAsync(30_000);
    await v.p;
    expect(types(v.events).filter((x) => x !== 'alive')).toEqual(['card-shown', 'tick 3', 'tick 2', 'tick 1', 'hidden']);
  });

  it('a popover that opens after card-shown: hidden, never take', async () => {
    const v = play((e) => { if (e.type === 'tick' && e.remaining === 3) popover = true; });
    await vi.advanceTimersByTimeAsync(30_000);
    await v.p;
    expect(types(v.events).filter((x) => x !== 'alive')).toEqual(['card-shown', 'tick 3', 'tick 2', 'tick 1', 'hidden']);
  });
});
