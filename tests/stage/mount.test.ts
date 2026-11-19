// @vitest-environment jsdom
// The pointer listeners exist only while a visit is playing, and never in reduced motion.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VisitPlan } from '../../src/shared/types';

let finish: () => void = () => {};
let started: () => void = () => {};
vi.mock('../../src/stage/sequence', async (orig) => ({
  ...(await orig<typeof import('../../src/stage/sequence')>()),
  runVisit: () => new Promise<void>((r) => { finish = r; started(); }),
}));

import { mountStage, type Stage } from '../../src/stage/mount';

const plan: VisitPlan = {
  visitId: 'v1', targetTabId: 7, title: 'Old page', reason: 'stale', reasonText: 'x',
  tabIndex: 1, tabCount: 3, countdownSeconds: 3, targetIsStage: false,
};
const POINTER = ['pointermove', 'pointerout'];

let reduced = false;
let stage: Stage;
let added: string[];
let removed: string[];

beforeEach(async () => {
  reduced = false;
  window.matchMedia = ((q: string) => ({ matches: reduced, media: q })) as unknown as typeof window.matchMedia;
  window.requestAnimationFrame = (() => 1) as unknown as typeof window.requestAnimationFrame;
  window.cancelAnimationFrame = (() => {}) as typeof window.cancelAnimationFrame;
  HTMLCanvasElement.prototype.getContext = (() => new Proxy({}, { get: () => () => {} })) as never;
  document.body.innerHTML = '';
  stage = await mountStage(document, { sprites: { sheets: [], meta: {} as never }, iconUrl: '' });
  added = [];
  removed = [];
  const add = window.addEventListener.bind(window);
  const rem = window.removeEventListener.bind(window);
  vi.spyOn(window, 'addEventListener').mockImplementation(((t: string, ...a: unknown[]) => { added.push(t); return (add as (...x: unknown[]) => void)(t, ...a); }) as never);
  vi.spyOn(window, 'removeEventListener').mockImplementation(((t: string, ...a: unknown[]) => { removed.push(t); return (rem as (...x: unknown[]) => void)(t, ...a); }) as never);
});
afterEach(() => { vi.restoreAllMocks(); stage.destroy(); });

const live = (): string[] => POINTER.filter((t) => added.filter((x) => x === t).length > removed.filter((x) => x === t).length);
const begin = async (): Promise<{ then?: never; done: Promise<void> }> => {
  const ready = new Promise<void>((r) => { started = r; });
  const p = stage.play(plan, () => {});
  await ready;
  return { done: p };
};

describe('pointer listening', () => {
  it('is off before any play', () => {
    expect(added.filter((t) => POINTER.includes(t))).toEqual([]);
  });
  it('is on during play, passive and capturing, and off when the visit ends', async () => {
    const p = await begin();
    expect(live().sort()).toEqual([...POINTER].sort());
    expect((window.addEventListener as unknown as ReturnType<typeof vi.fn>).mock.calls.find((c) => c[0] === 'pointermove')![2])
      .toEqual({ capture: true, passive: true });
    finish();
    await p.done;
    expect(live()).toEqual([]);
  });
  it('is off after cancel and after destroy', async () => {
    let p = await begin();
    stage.cancel();
    expect(live()).toEqual([]);
    finish(); await p.done;
    p = await begin();
    expect(live().length).toBe(2);
    stage.destroy();
    expect(live()).toEqual([]);
    finish(); await p.done;
  });
  it('a second play does not stack listeners, and each ending removes them', async () => {
    let p = await begin();
    finish(); await p.done;
    p = await begin();
    expect(live().length).toBe(2);
    finish(); await p.done;
    expect(live()).toEqual([]);
  });
  it('is never attached in reduced motion', async () => {
    reduced = true;
    const p = await begin();
    expect(added.filter((t) => POINTER.includes(t))).toEqual([]);
    finish(); await p.done;
    expect(added.filter((t) => POINTER.includes(t))).toEqual([]);
  });
});
