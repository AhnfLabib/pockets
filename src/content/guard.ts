// Run-once guards for the content scripts, kept on the isolated world's globalThis.
//
// content.js can run twice in one frame: declared in the manifest, and injected by the background into tabs that were
// open before install or update (background/inject.ts). The second run must do nothing. After an extension update or
// reload, the old instance is orphaned (its chrome.runtime is dead) but may still sit in the same isolated world; the
// new one must start anyway. So a record is honoured only if it comes from this exact build AND its owner still has a
// live extension context, asked through the owner's own closure (it captured its own chrome.runtime at start).

/** Set by content.js when an instance starts in this frame. */
export const CONTENT_KEY = '__pocketsContent';
/** Set by content-start.js at document_start in the top frame, right before it sends pockets/page-loaded. */
export const START_KEY = '__pocketsStart';

export interface GuardRecord {
  /** Extension id, manifest version and a per-build stamp. */
  build: string;
  /** True while the owner's extension context is alive. Runs in the owner's closure. */
  alive(): boolean;
  /** Tears the owner down. Called when a new instance replaces a dead one. */
  dispose?(): void;
}

type Slots = Record<string, unknown>;

/** A record left by a live instance of this same build. Anything else (missing, malformed, other build, dead
 *  context, or alive() throwing) is not live. */
export function isLive(rec: unknown, build: string): boolean {
  if (!rec || typeof rec !== 'object') return false;
  const r = rec as Partial<GuardRecord>;
  if (r.build !== build || typeof r.alive !== 'function') return false;
  try {
    return r.alive() === true;
  } catch {
    return false;
  }
}

/**
 * Claims `key` for `mine`. Returns false, changing nothing, when a live instance of the same build holds it: the caller
 * must then do nothing. Otherwise disposes any previous (dead or other-build) holder, stores `mine`, and returns true.
 */
export function claim(g: Slots, key: string, mine: GuardRecord): boolean {
  const prev = g[key];
  if (isLive(prev, mine.build)) return false;
  if (prev && typeof prev === 'object' && typeof (prev as GuardRecord).dispose === 'function') {
    try { (prev as GuardRecord).dispose!(); } catch { /* the old instance is already broken */ }
  }
  g[key] = mine;
  return true;
}

/** A liveness check over a chrome.runtime captured now: once the extension is updated, reloaded or removed, the
 *  captured object's id reads undefined (or throws), even if a newer instance is running in the same world. */
export function contextProbe(runtime: { id?: string } | undefined): () => boolean {
  return () => {
    try {
      return typeof runtime?.id === 'string' && runtime.id.length > 0;
    } catch {
      return false;
    }
  };
}
