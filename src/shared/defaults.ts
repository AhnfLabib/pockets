import type { Settings } from './types';

export const DEFAULT_SETTINGS: Settings = {
  staleHours: 24,
  gapMinutes: 5,
  stalePerHour: 4,
  countdownSeconds: 5,
  distracting: ['youtube.com', 'reddit.com', 'x.com', 'twitter.com', 'instagram.com', 'facebook.com', 'tiktok.com', 'netflix.com'],
  neverTake: [],
};

function num(v: unknown, def: number, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return def;
  return Math.min(max, Math.max(min, v));
}

function list(v: unknown, def: string[]): string[] {
  if (!Array.isArray(v)) return [...def];
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== 'string') continue;
    const s = item.trim().toLowerCase();
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

/** Fill gaps with defaults and clamp nonsense values to safe ranges. */
export function clampSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  return {
    staleHours: num(r.staleHours, d.staleHours, 1, 720),
    gapMinutes: num(r.gapMinutes, d.gapMinutes, 1, 240),
    stalePerHour: num(r.stalePerHour, d.stalePerHour, 0, 60),
    countdownSeconds: num(r.countdownSeconds, d.countdownSeconds, 3, 30),
    distracting: list(r.distracting, d.distracting),
    neverTake: list(r.neverTake, d.neverTake),
  };
}
