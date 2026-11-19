// Pure target choice. No chrome.* access, no Date.now(): time is `now`.
import type { Reason, RuntimeState, Settings, TabInfo } from '../shared/types';
import { matchesSite } from './sites';

export function pickTarget(
  tabs: TabInfo[], focusedWindowId: number, s: Settings, rt: RuntimeState, now: number,
): { tab: TabInfo; reason: Reason } | null {
  const candidates = tabs.filter((t) => t.windowId === focusedWindowId && !matchesSite(t.url, s.neverTake));

  if (rt.working) {
    const distracting = candidates
      .filter((t) => !t.pinned
        && matchesSite(t.url, s.distracting)
        && rt.spared[t.id]?.workingSince !== rt.workingSince)
      .sort((a, b) => a.lastAccessed - b.lastAccessed);
    if (distracting.length > 0) return { tab: distracting[0], reason: 'distracting' };
  }

  const staleMs = s.staleHours * 3600_000;
  const stale = candidates
    .filter((t) => !t.pinned && !t.audible && !t.active
      && !rt.typedIn.includes(t.id)
      && !((rt.spared[t.id]?.until ?? 0) > now)
      && now - t.lastAccessed > staleMs)
    .sort((a, b) => a.lastAccessed - b.lastAccessed);
  return stale.length > 0 ? { tab: stale[0], reason: 'stale' } : null;
}
