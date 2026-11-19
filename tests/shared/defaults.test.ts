import { describe, it, expect } from 'vitest';
import { clampSettings, DEFAULT_SETTINGS } from '../../src/shared/defaults';

describe('clampSettings', () => {
  it('returns defaults for undefined and {}', () => {
    expect(clampSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(clampSettings({})).toEqual(DEFAULT_SETTINGS);
  });
  it('clamps staleHours to [1, 720]', () => {
    expect(clampSettings({ staleHours: -3 }).staleHours).toBe(1);
    expect(clampSettings({ staleHours: 9999 }).staleHours).toBe(720);
  });
  it('falls back to default for non-numbers', () => {
    expect(clampSettings({ staleHours: 'x' }).staleHours).toBe(DEFAULT_SETTINGS.staleHours);
    expect(clampSettings({ gapMinutes: NaN }).gapMinutes).toBe(DEFAULT_SETTINGS.gapMinutes);
  });
  it('clamps gapMinutes, countdownSeconds, stalePerHour', () => {
    expect(clampSettings({ gapMinutes: 0 }).gapMinutes).toBe(1);
    expect(clampSettings({ gapMinutes: 999 }).gapMinutes).toBe(240);
    expect(clampSettings({ countdownSeconds: 1 }).countdownSeconds).toBe(3);
    expect(clampSettings({ countdownSeconds: 99 }).countdownSeconds).toBe(30);
    expect(clampSettings({ stalePerHour: 100 }).stalePerHour).toBe(60);
    expect(clampSettings({ stalePerHour: -2 }).stalePerHour).toBe(0);
  });
  it('preserves stalePerHour 0', () => {
    expect(clampSettings({ stalePerHour: 0 }).stalePerHour).toBe(0);
  });
  it('trims, lower-cases, de-duplicates and drops blanks in lists', () => {
    expect(clampSettings({ distracting: [' YouTube.com ', '', 'youtube.com'] }).distracting).toEqual(['youtube.com']);
    expect(clampSettings({ neverTake: ['  ', 'A.com', 'a.COM', 7] }).neverTake).toEqual(['a.com']);
  });
  it('uses default lists when not arrays', () => {
    expect(clampSettings({ distracting: 'x' }).distracting).toEqual(DEFAULT_SETTINGS.distracting);
  });
  it('does not share list references with defaults', () => {
    expect(clampSettings(undefined).distracting).not.toBe(DEFAULT_SETTINGS.distracting);
  });
});
