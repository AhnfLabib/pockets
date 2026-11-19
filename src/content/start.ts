// content-start.js: declared at document_start in the top frame only, never injected by the background.
//
// A new document in the top frame means typing reported for the previous one no longer counts ("typed into since the
// page loaded"). Nothing can be typed before document_start, so no typing report for this document can precede this
// message. It is not re-run when a page is restored from the back/forward cache (no new document), and the injection
// path for tabs open before install (background/inject.ts) only injects content.js, so neither sends it.
//
// It also leaves a record in the isolated world. content.js, starting later in this document, finds it and knows the
// page-loaded was sent; a content.js that finds no live record of its own build was injected into (or started in) a
// document whose start it never saw, so it reports the typing as unknown (see host.ts, typingUnknown).
import { START_KEY, contextProbe, type GuardRecord } from './guard';
import { buildStamp } from './stamp';

const g = globalThis as unknown as Record<string, unknown>;
const rec: GuardRecord = { build: buildStamp(), alive: contextProbe(chrome.runtime) };
g[START_KEY] = rec;
try {
  void chrome.runtime.sendMessage({ type: 'pockets/page-loaded' }).catch(() => {});
} catch {
  /* no extension context: nothing to tell */
}
