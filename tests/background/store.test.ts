import { describe, it, expect } from 'vitest';
import { Store, spareKept, setWorking, forgetTab, type KV, type TakenTab } from '../../src/background/store';
import { DEFAULT_SETTINGS } from '../../src/shared/defaults';
import type { RuntimeState } from '../../src/shared/types';

function mapKV(): KV {
  const m = new Map<string, unknown>();
  return { get: async (k) => m.get(k), set: async (k, v) => { m.set(k, v); } };
}
const rt = (o: Partial<RuntimeState> = {}): RuntimeState => ({
  working: false, workingSince: 0, spared: {}, typedIn: [], staleTakes: [], lastStaleVisitEnd: 0, lastDistractingTake: 0, visit: null, ...o,
});
const tab = (takenAt: number): TakenTab => ({ title: 't' + takenAt, url: 'https://a.com/' + takenAt, takenAt, reason: 'stale' });

describe('Store', () => {
  it('returns defaults when empty', async () => {
    const s = new Store(mapKV());
    expect(await s.settings()).toEqual(DEFAULT_SETTINGS);
    expect(await s.runtime()).toEqual(rt());
    expect(await s.taken()).toEqual([]);
  });
  it('round-trips and clamps settings', async () => {
    const s = new Store(mapKV());
    await s.saveSettings({ ...DEFAULT_SETTINGS, staleHours: 5000 });
    expect((await s.settings()).staleHours).toBe(720);
  });
  it('round-trips runtime', async () => {
    const s = new Store(mapKV());
    await s.saveRuntime(rt({ working: true, workingSince: 9 }));
    expect((await s.runtime()).workingSince).toBe(9);
  });
  it('addTaken keeps the newest 200', async () => {
    const s = new Store(mapKV());
    for (let i = 1; i <= 205; i++) await s.addTaken(tab(i));
    const t = await s.taken();
    expect(t).toHaveLength(200);
    expect(t.map((x) => x.takenAt)).toContain(205);
    expect(t.map((x) => x.takenAt)).not.toContain(5);
    expect(t.map((x) => x.takenAt)).toContain(6);
  });
  it('removeTaken removes by takenAt', async () => {
    const s = new Store(mapKV());
    await s.addTaken(tab(1)); await s.addTaken(tab(2));
    await s.removeTaken(1);
    expect((await s.taken()).map((x) => x.takenAt)).toEqual([2]);
  });
});

describe('transitions', () => {
  it('spareKept stale sets until = now + staleHours', () => {
    const now = 1_000_000;
    const out = spareKept(rt(), 7, 'stale', DEFAULT_SETTINGS, now);
    expect(out.spared[7]).toEqual({ until: now + DEFAULT_SETTINGS.staleHours * 3_600_000 });
  });
  it('spareKept distracting sets workingSince from rt', () => {
    const out = spareKept(rt({ workingSince: 555 }), 7, 'distracting', DEFAULT_SETTINGS, 9999);
    expect(out.spared[7]).toEqual({ workingSince: 555 });
  });
  it('setWorking on sets workingSince = now; off leaves it', () => {
    const on = setWorking(rt(), true, 1234);
    expect(on.working).toBe(true);
    expect(on.workingSince).toBe(1234);
    const off = setWorking(on, false, 5000);
    expect(off.working).toBe(false);
    expect(off.workingSince).toBe(1234);
  });
  it('forgetTab removes from spared and typedIn', () => {
    const out = forgetTab(rt({ spared: { 1: { until: 1 }, 2: { until: 2 } }, typedIn: [1, 2, 3] }), 1);
    expect(out.spared).toEqual({ 2: { until: 2 } });
    expect(out.typedIn).toEqual([2, 3]);
  });
  it('transitions do not mutate input', () => {
    const base = rt({ spared: { 1: { until: 1 } }, typedIn: [1, 2] });
    const snap = JSON.parse(JSON.stringify(base));
    spareKept(base, 3, 'stale', DEFAULT_SETTINGS, 10);
    spareKept(base, 3, 'distracting', DEFAULT_SETTINGS, 10);
    setWorking(base, true, 10);
    forgetTab(base, 1);
    expect(base).toEqual(snap);
  });
});

describe('corrupt storage', () => {
  it('runtime() falls back per field and forgetTab does not throw', async () => {
    for (const field of ['typedIn', 'staleTakes', 'spared', 'visit', 'working', 'workingSince', 'lastStaleVisitEnd', 'lastDistractingTake']) {
      for (const v of ['str', null, 5, 'x'.repeat(2)]) {
        const kv = mapKV();
        await kv.set('runtime', { ...rt(), [field]: v });
        const r = await new Store(kv).runtime();
        expect(Array.isArray(r.typedIn)).toBe(true);
        expect(Array.isArray(r.staleTakes)).toBe(true);
        expect(() => forgetTab(r, 1)).not.toThrow();
      }
    }
  });
  it('filters non-numbers from arrays and bad spared entries', async () => {
    const kv = mapKV();
    await kv.set('runtime', rt({ typedIn: [1, 'a', null, 2] as never, spared: { 1: 'x', 2: { until: 3 } } as never, visit: 7 as never }));
    const r = await new Store(kv).runtime();
    expect(r.typedIn).toEqual([1, 2]);
    expect(r.spared).toEqual({ 2: { until: 3 } });
    expect(r.visit).toBeNull();
  });
  it('whole runtime value as array gives defaults', async () => {
    const kv = mapKV();
    await kv.set('runtime', [1, 2]);
    expect(await new Store(kv).runtime()).toEqual(rt());
  });
  it('taken() drops invalid elements and removeTaken works', async () => {
    const kv = mapKV();
    const good = tab(4);
    await kv.set('taken', [null, 5, good]);
    const s = new Store(kv);
    expect(await s.taken()).toEqual([good]);
    await s.removeTaken(4);
    expect(await s.taken()).toEqual([]);
  });
});
