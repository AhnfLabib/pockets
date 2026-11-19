import { describe, it, expect } from 'vitest';
import { canVisit } from '../../src/rules/pacing';
import { DEFAULT_SETTINGS } from '../../src/shared/defaults';
import type { RuntimeState } from '../../src/shared/types';

const NOW = 10_000_000_000;
const MIN = 60_000;
const rt = (o: Partial<RuntimeState> = {}): RuntimeState => ({
  working: false, workingSince: 0, spared: {}, typedIn: [], staleTakes: [],
  lastStaleVisitEnd: 0, lastDistractingTake: 0, visit: null, ...o,
});
const ctx = (o = {}) => ({ now: NOW, userActive: true, windowFocused: true, ...o });
const visit = { visitId: 'v', targetTabId: 1, targetUrl: 'u', stageTabId: 2, reason: 'stale' as const, cardShown: false, startedAt: NOW };

describe('canVisit', () => {
  for (const reason of ['stale', 'distracting'] as const) {
    it(`${reason}: allowed when idle`, () => {
      expect(canVisit(reason, DEFAULT_SETTINGS, rt(), ctx())).toBe(true);
    });
    it(`${reason}: false while a visit is active`, () => {
      expect(canVisit(reason, DEFAULT_SETTINGS, rt({ visit }), ctx())).toBe(false);
    });
    it(`${reason}: false when user inactive`, () => {
      expect(canVisit(reason, DEFAULT_SETTINGS, rt(), ctx({ userActive: false }))).toBe(false);
    });
    it(`${reason}: false when window unfocused`, () => {
      expect(canVisit(reason, DEFAULT_SETTINGS, rt(), ctx({ windowFocused: false }))).toBe(false);
    });
  }

  it('stale: false 4m59s after last visit end, true at 5m', () => {
    expect(canVisit('stale', DEFAULT_SETTINGS, rt({ lastStaleVisitEnd: NOW - (5 * MIN - 1000) }), ctx())).toBe(false);
    expect(canVisit('stale', DEFAULT_SETTINGS, rt({ lastStaleVisitEnd: NOW - 5 * MIN }), ctx())).toBe(true);
  });
  it('stale: false with 4 takes in the last hour', () => {
    const takes = [10, 20, 30, 40].map((m) => NOW - m * MIN);
    expect(canVisit('stale', DEFAULT_SETTINGS, rt({ staleTakes: takes }), ctx())).toBe(false);
  });
  it('stale: true when the oldest of 4 takes is 61 min old', () => {
    const takes = [61, 40, 30, 20].map((m) => NOW - m * MIN);
    expect(canVisit('stale', DEFAULT_SETTINGS, rt({ staleTakes: takes }), ctx())).toBe(true);
  });
  it('stale: always false when stalePerHour is 0', () => {
    expect(canVisit('stale', { ...DEFAULT_SETTINGS, stalePerHour: 0 }, rt(), ctx())).toBe(false);
  });
  it('distracting: ignores gap and cap', () => {
    const takes = [1, 2, 3, 4, 5].map((m) => NOW - m * MIN);
    expect(canVisit('distracting', DEFAULT_SETTINGS, rt({ staleTakes: takes, lastStaleVisitEnd: NOW - 1000 }), ctx())).toBe(true);
    expect(canVisit('distracting', { ...DEFAULT_SETTINGS, stalePerHour: 0 }, rt(), ctx())).toBe(true);
  });
  it('distracting: false 29s after last take, true at 30s', () => {
    expect(canVisit('distracting', DEFAULT_SETTINGS, rt({ lastDistractingTake: NOW - 29_000 }), ctx())).toBe(false);
    expect(canVisit('distracting', DEFAULT_SETTINGS, rt({ lastDistractingTake: NOW - 30_000 }), ctx())).toBe(true);
  });
});
