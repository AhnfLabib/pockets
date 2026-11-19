import type { ActiveVisit, Reason, RuntimeState, Settings, Spare } from '../shared/types';
import { clampSettings } from '../shared/defaults';

export interface TakenTab { title: string; url: string; favIconUrl?: string; takenAt: number; reason: Reason; sessionId?: string }

/** Backed by chrome.storage.local (wrapped) in production, a Map in tests. */
export interface KV { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<void> }

const MAX_TAKEN = 200;
const HOUR_MS = 3_600_000;

function isObj(v: unknown): v is Record<string, unknown> { return typeof v === 'object' && v !== null && !Array.isArray(v); }
function finite(v: unknown): v is number { return typeof v === 'number' && Number.isFinite(v); }
function nums(v: unknown): number[] { return Array.isArray(v) ? v.filter(finite) : []; }

function defaultRuntime(): RuntimeState {
  return { working: false, workingSince: 0, spared: {}, typedIn: [], staleTakes: [], lastStaleVisitEnd: 0, lastDistractingTake: 0, visit: null };
}

export class Store {
  constructor(private kv: KV) {}

  async settings(): Promise<Settings> { return clampSettings(await this.kv.get('settings')); }
  async saveSettings(s: Settings): Promise<void> { await this.kv.set('settings', clampSettings(s)); }

  async runtime(): Promise<RuntimeState> {
    const raw = await this.kv.get('runtime');
    const d = defaultRuntime();
    if (!isObj(raw)) return d;
    const spared: Record<number, Spare> = {};
    if (isObj(raw.spared)) {
      for (const [k, v] of Object.entries(raw.spared)) if (isObj(v)) spared[Number(k)] = v as Spare;
    }
    return {
      working: typeof raw.working === 'boolean' ? raw.working : d.working,
      workingSince: finite(raw.workingSince) ? raw.workingSince : d.workingSince,
      spared,
      typedIn: nums(raw.typedIn),
      staleTakes: nums(raw.staleTakes),
      lastStaleVisitEnd: finite(raw.lastStaleVisitEnd) ? raw.lastStaleVisitEnd : d.lastStaleVisitEnd,
      lastDistractingTake: finite(raw.lastDistractingTake) ? raw.lastDistractingTake : d.lastDistractingTake,
      visit: isObj(raw.visit) ? (raw.visit as unknown as ActiveVisit) : null,
    };
  }
  async saveRuntime(rt: RuntimeState): Promise<void> { await this.kv.set('runtime', rt); }

  async taken(): Promise<TakenTab[]> {
    const raw = await this.kv.get('taken');
    if (!Array.isArray(raw)) return [];
    return raw.filter((x): x is TakenTab => isObj(x) && finite(x.takenAt) && typeof x.url === 'string');
  }
  async addTaken(t: TakenTab): Promise<void> {
    const list = [...(await this.taken()), t];
    await this.kv.set('taken', list.slice(-MAX_TAKEN));
  }
  async removeTaken(takenAt: number): Promise<void> {
    await this.kv.set('taken', (await this.taken()).filter((x) => x.takenAt !== takenAt));
  }
}

export function spareKept(rt: RuntimeState, tabId: number, reason: Reason, s: Settings, now: number): RuntimeState {
  const spare = reason === 'stale' ? { until: now + s.staleHours * HOUR_MS } : { workingSince: rt.workingSince };
  return { ...rt, spared: { ...rt.spared, [tabId]: spare } };
}

export function setWorking(rt: RuntimeState, on: boolean, now: number): RuntimeState {
  return on ? { ...rt, working: true, workingSince: now } : { ...rt, working: false };
}

export function forgetTab(rt: RuntimeState, tabId: number): RuntimeState {
  const spared = { ...rt.spared };
  delete spared[tabId];
  return { ...rt, spared, typedIn: rt.typedIn.filter((id) => id !== tabId) };
}
