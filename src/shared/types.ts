// Types shared by the background, the content script and the stage.

export interface VisitPlan { visitId: string; targetTabId: number; title: string; faviconUrl?: string; reason: 'stale' | 'distracting';
                             reasonText: string; tabIndex: number; tabCount: number; countdownSeconds: number; targetIsStage: boolean;
                             /** The visit is resuming after a pause: no climb, Pockets is already at the tab bar. Present only when true. */
                             resume?: true }
export type VisitEvent = { type: 'card-shown' } | { type: 'tick'; remaining: number } | { type: 'keep' } | { type: 'take' } | { type: 'done' } | { type: 'undo' }
                       | { type: 'hidden' } | { type: 'alive' };

export interface TabInfo { id: number; windowId: number; index: number; url: string; title: string; favIconUrl?: string;
                           active: boolean; pinned: boolean; audible: boolean; discarded: boolean; lastAccessed: number }
export interface Settings { staleHours: number; gapMinutes: number; stalePerHour: number; countdownSeconds: number; distracting: string[]; neverTake: string[] }
export interface Spare { until?: number; workingSince?: number }
export type Reason = 'stale' | 'distracting';
/** A visit paused because its stage stopped being in front (see visit.ts). Everything a decision needs after a worker
 *  restart is here: the in-memory presentation of the visit does not survive the worker. */
export interface VisitPause {
  /** When the stage stopped being in front. */
  at: number;
  /** The browser run this pause belongs to (chrome.storage.session is cleared on a browser restart). */
  bootId: string;
  /** The plan the stage was playing, for the resume. */
  plan: VisitPlan;
  /** The target's window at the start of the visit. */
  windowId: number;
  /** A system notification was attempted for the current away period. */
  notifyTried?: boolean;
  /** Set only once the warning notification was created successfully: when, and its id. */
  notifiedAt?: number;
  notificationId?: string;
  /** The user clicked the warning notification: this pause never takes while away. */
  clickedAt?: number;
}
export interface ActiveVisit { visitId: string; targetTabId: number; targetUrl: string; stageTabId: number; reason: Reason; cardShown: boolean; startedAt: number;
                               pause?: VisitPause }
export interface RuntimeState { working: boolean; workingSince: number; spared: Record<number, Spare>; typedIn: number[];
                                staleTakes: number[]; lastStaleVisitEnd: number; lastDistractingTake: number; visit: ActiveVisit | null }

export type ToContent = { type: 'pockets/ping' } | { type: 'pockets/play'; plan: VisitPlan } | { type: 'pockets/cancel'; visitId: string }
                      | { type: 'pockets/mark'; remaining: number } | { type: 'pockets/unmark' } | { type: 'pockets/notice'; title: string; takenAt: number };
export type ToBackground = { type: 'pockets/typed' } | { type: 'pockets/page-loaded' } | { type: 'pockets/event'; visitId: string; event: VisitEvent } | { type: 'pockets/undo'; takenAt: number } | { type: 'pockets/set-working'; on: boolean };
