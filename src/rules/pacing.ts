import type { Reason, RuntimeState, Settings } from '../shared/types';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DISTRACTING_GAP = 30_000;

export function canVisit(
  reason: Reason,
  s: Settings,
  rt: RuntimeState,
  ctx: { now: number; userActive: boolean; windowFocused: boolean },
): boolean {
  if (rt.visit !== null || !ctx.userActive || !ctx.windowFocused) return false;
  if (reason === 'distracting') return ctx.now - rt.lastDistractingTake >= DISTRACTING_GAP;
  if (s.stalePerHour <= 0) return false;
  if (ctx.now - rt.lastStaleVisitEnd < s.gapMinutes * MINUTE) return false;
  const recent = rt.staleTakes.filter((t) => ctx.now - t < HOUR).length;
  return recent < s.stalePerHour;
}
