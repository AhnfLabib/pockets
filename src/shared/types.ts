// Types shared by the background, the content script and the stage.

export interface VisitPlan { visitId: string; targetTabId: number; title: string; faviconUrl?: string; reason: 'stale' | 'distracting';
                             reasonText: string; tabIndex: number; tabCount: number; countdownSeconds: number; targetIsStage: boolean }
export type VisitEvent = { type: 'card-shown' } | { type: 'tick'; remaining: number } | { type: 'keep' } | { type: 'take' } | { type: 'done' } | { type: 'undo' };
