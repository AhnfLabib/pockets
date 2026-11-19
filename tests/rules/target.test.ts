import { describe, it, expect } from 'vitest';
import { pickTarget } from '../../src/rules/target';
import { DEFAULT_SETTINGS } from '../../src/shared/defaults';
import type { TabInfo, RuntimeState, Settings } from '../../src/shared/types';

const H = 3600_000;
const now = 1_000_000_000_000;
const s: Settings = { ...DEFAULT_SETTINGS };
const rt = (o: Partial<RuntimeState> = {}): RuntimeState => ({
  working: false, workingSince: 0, spared: {}, typedIn: [], staleTakes: [],
  lastStaleVisitEnd: 0, lastDistractingTake: 0, visit: null, ...o,
});
let nextId = 1;
const tab = (o: Partial<TabInfo> = {}): TabInfo => ({
  id: nextId++, windowId: 1, index: 0, url: 'https://example.com/', title: 't',
  active: false, pinned: false, audible: false, discarded: false, lastAccessed: now - 25 * H, ...o,
});

/** The page being looked at: active and fresh, never a candidate. It keeps the tab under test from being alone in its
 *  window, which by itself rules a tab out (see "never closes a window" below). */
const stage = (o: Partial<TabInfo> = {}): TabInfo => tab({ active: true, lastAccessed: now, url: 'https://work.example/', ...o });

describe('pickTarget: stale rule', () => {
  it('picks a non-active tab 25h old as stale', () => {
    const t = tab();
    expect(pickTarget([t, stage()], 1, s, rt(), now)).toEqual({ tab: t, reason: 'stale' });
  });
  it('does not pick a tab 23h old', () => {
    expect(pickTarget([tab({ lastAccessed: now - 23 * H }), stage()], 1, s, rt(), now)).toBeNull();
  });
  it('picks a chrome://newtab tab 25h old', () => {
    const t = tab({ url: 'chrome://newtab' });
    expect(pickTarget([t, stage()], 1, s, rt(), now)?.tab).toBe(t);
  });
  it('picks the oldest among several', () => {
    const a = tab({ lastAccessed: now - 30 * H });
    const b = tab({ lastAccessed: now - 50 * H });
    const c = tab({ lastAccessed: now - 26 * H });
    expect(pickTarget([a, b, c], 1, s, rt(), now)?.tab).toBe(b);
  });
  it('never picks pinned', () => {
    expect(pickTarget([tab({ pinned: true }), stage()], 1, s, rt(), now)).toBeNull();
  });
  it('never picks audible', () => {
    expect(pickTarget([tab({ audible: true }), stage()], 1, s, rt(), now)).toBeNull();
  });
  it('never picks active', () => {
    expect(pickTarget([tab({ active: true }), stage()], 1, s, rt(), now)).toBeNull();
  });
  it('never picks a tab in typedIn', () => {
    const t = tab();
    expect(pickTarget([t, stage()], 1, s, rt({ typedIn: [t.id] }), now)).toBeNull();
  });
  it('never picks a neverTake site', () => {
    const t = tab({ url: 'https://docs.bank.com/x' });
    expect(pickTarget([t, stage()], 1, { ...s, neverTake: ['bank.com'] }, rt(), now)).toBeNull();
  });
  it('never picks a tab in another window', () => {
    expect(pickTarget([tab({ windowId: 2 }), stage()], 1, s, rt(), now)).toBeNull();
  });
  it('never picks a tab spared until the future', () => {
    const t = tab();
    expect(pickTarget([t, stage()], 1, s, rt({ spared: { [t.id]: { until: now + 1000 } } }), now)).toBeNull();
  });
  it('picks a tab whose spare has expired', () => {
    const t = tab();
    expect(pickTarget([t, stage()], 1, s, rt({ spared: { [t.id]: { until: now - 1 } } }), now)?.tab).toBe(t);
  });
});

describe('pickTarget: distracting rule', () => {
  const yt = (o: Partial<TabInfo> = {}) => tab({ url: 'https://www.youtube.com/watch', lastAccessed: now - 60_000, ...o });
  const work = (o: Partial<RuntimeState> = {}) => rt({ working: true, workingSince: 500, ...o });

  it('not working: a 1-minute-old youtube tab is not picked', () => {
    expect(pickTarget([yt(), stage()], 1, s, rt(), now)).toBeNull();
  });
  it('working: picked as distracting', () => {
    const t = yt();
    expect(pickTarget([t, stage()], 1, s, work(), now)).toEqual({ tab: t, reason: 'distracting' });
  });
  it('working: ahead of an older stale tab', () => {
    const stale = tab({ lastAccessed: now - 100 * H });
    const t = yt();
    const r = pickTarget([stale, t], 1, s, work(), now);
    expect(r?.tab).toBe(t);
    expect(r?.reason).toBe('distracting');
  });
  it('working: picked even when active', () => {
    const t = yt({ active: true });
    expect(pickTarget([t, stage()], 1, s, work(), now)?.tab).toBe(t);
  });
  it('working: picked even when audible', () => {
    const t = yt({ audible: true });
    expect(pickTarget([t, stage()], 1, s, work(), now)?.tab).toBe(t);
  });
  it('working: not picked when pinned', () => {
    expect(pickTarget([yt({ pinned: true }), stage()], 1, s, work(), now)).toBeNull();
  });
  it('working: not picked when on neverTake', () => {
    expect(pickTarget([yt(), stage()], 1, { ...s, neverTake: ['youtube.com'] }, work(), now)).toBeNull();
  });
  it('working: not picked when spared this working session', () => {
    const t = yt();
    expect(pickTarget([t, stage()], 1, s, work({ spared: { [t.id]: { workingSince: 500 } } }), now)).toBeNull();
  });
  it('working: picked again when the spare is from an older working session', () => {
    const t = yt();
    expect(pickTarget([t, stage()], 1, s, work({ spared: { [t.id]: { workingSince: 100 } } }), now)?.tab).toBe(t);
  });
  it('working: a typed-in youtube tab is not picked', () => {
    const t = yt();
    expect(pickTarget([t, stage()], 1, s, work({ typedIn: [t.id] }), now)).toBeNull();
  });
  it('working: a spared (this session) youtube tab 25h old is not picked as stale either', () => {
    const t = yt({ lastAccessed: now - 25 * H });
    expect(pickTarget([t, stage()], 1, s, work({ spared: { [t.id]: { workingSince: 500 } } }), now)).toBeNull();
  });
  it('not working: the same 25h-old youtube tab is picked as stale', () => {
    const t = yt({ lastAccessed: now - 25 * H });
    expect(pickTarget([t, stage()], 1, s, rt({ spared: { [t.id]: { workingSince: 500 } }, workingSince: 500 }), now))
      .toEqual({ tab: t, reason: 'stale' });
  });
});

describe('pickTarget: never closes a window', () => {
  it('skips a stale tab that is the only tab in its window', () => {
    const t = tab();
    expect(pickTarget([t], 1, s, rt(), now)).toBeNull();
    expect(pickTarget([t, stage()], 1, s, rt(), now)?.tab).toBe(t); // control: with a second tab it is picked
  });
  it('skips a distracting tab that is the only tab in its window, while working', () => {
    const t = tab({ url: 'https://www.youtube.com/watch', active: true, lastAccessed: now - 60_000 });
    const work = rt({ working: true, workingSince: 500 });
    expect(pickTarget([t], 1, s, work, now)).toBeNull();
    expect(pickTarget([t, tab({ lastAccessed: now })], 1, s, work, now)?.tab).toBe(t);
  });
  it('counts tabs by windowId: a tab of another window in the list does not make it two', () => {
    const t = tab();
    expect(pickTarget([t, stage({ windowId: 2 })], 1, s, rt(), now)).toBeNull();
  });
  it('a pinned or protected second tab still counts: the window would survive', () => {
    const t = tab();
    expect(pickTarget([t, tab({ pinned: true })], 1, s, rt(), now)?.tab).toBe(t);
  });
});
