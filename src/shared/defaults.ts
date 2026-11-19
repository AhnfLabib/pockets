import type { Settings } from './types';

export const DEFAULT_SETTINGS: Settings = {
  staleHours: 24,
  gapMinutes: 5,
  stalePerHour: 4,
  countdownSeconds: 5,
  distracting: ['youtube.com', 'reddit.com', 'x.com', 'twitter.com', 'instagram.com', 'facebook.com', 'tiktok.com', 'netflix.com'],
  neverTake: [],
};
