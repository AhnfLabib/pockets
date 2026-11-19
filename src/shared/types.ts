// Types shared by the background, the content script and the stage.

export interface VisitPlan { visitId: string; targetTabId: number; title: string; faviconUrl?: string; reason: 'stale' | 'distracting';
                             reasonText: string; tabIndex: number; tabCount: number; countdownSeconds: number; targetIsStage: boolean }
export type VisitEvent = { type: 'card-shown' } | { type: 'tick'; remaining: number } | { type: 'keep' } | { type: 'take' } | { type: 'done' } | { type: 'undo' }
                       | { type: 'hidden' };

export interface TabInfo { id: number; windowId: number; index: number; url: string; title: string; favIconUrl?: string;
                           active: boolean; pinned: boolean; audible: boolean; discarded: boolean; lastAccessed: number }
export interface Settings { staleHours: number; gapMinutes: number; stalePerHour: number; countdownSeconds: number; distracting: string[]; neverTake: string[] }
export interface Spare { until?: number; workingSince?: number }
export type Reason = 'stale' | 'distracting';
export interface ActiveVisit { visitId: string; targetTabId: number; targetUrl: string; stageTabId: number; reason: Reason; cardShown: boolean; startedAt: number }
export interface RuntimeState { working: boolean; workingSince: number; spared: Record<number, Spare>; typedIn: number[];
                                staleTakes: number[]; lastStaleVisitEnd: number; lastDistractingTake: number; visit: ActiveVisit | null }

export type ToContent = { type: 'pockets/ping' } | { type: 'pockets/play'; plan: VisitPlan } | { type: 'pockets/cancel'; visitId: string }
                      | { type: 'pockets/mark'; remaining: number } | { type: 'pockets/unmark' } | { type: 'pockets/notice'; title: string; takenAt: number };
export type ToBackground = { type: 'pockets/typed' } | { type: 'pockets/event'; visitId: string; event: VisitEvent } | { type: 'pockets/undo'; takenAt: number } | { type: 'pockets/set-working'; on: boolean };
