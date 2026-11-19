// Content script entry (content.js): wires the real chrome APIs into the host logic.
//
// It may run twice in one frame (declared in the manifest, and injected by the background into tabs open before
// install or update), so it first claims the frame (guard.ts); a second run of the same live build does nothing.
// Imports are hoisted above this code by the bundler; none of them touches the page when loaded.
//
// Nothing here loads a chrome-extension:// URL into the page: the sprites and icons come from the background as data
// URLs (pockets/sprites, and the icon on pockets/mark), so the manifest needs no web_accessible_resources. The instance
// shuts itself down once its own extension context dies (host.ts, `alive`).
import { mountStage } from '../stage/mount';
import { loadSprites } from '../stage/render';
import { startContent } from './host';
import { CONTENT_KEY, START_KEY, claim, contextProbe, isLive } from './guard';
import { buildStamp } from './stamp';

const g = globalThis as unknown as Record<string, unknown>;
const build = buildStamp();
const probe = contextProbe(chrome.runtime);
let alive = probe;
// ---- Test builds only: lets an e2e test orphan this instance (as an extension reload would) without killing the
// worker, by setting this flag in the isolated world with chrome.scripting.executeScript. Removed from normal builds.
declare const __POCKETS_TEST__: boolean;
if (__POCKETS_TEST__) alive = () => probe() && g.__pocketsTestOrphan !== true;
let handle: { dispose(): void } | null = null;

if (alive() && claim(g, CONTENT_KEY, { build, alive, doc: document, dispose: () => handle?.dispose() })) {
  handle = startContent({
    win: window,
    doc: document,
    alive,
    sendMessage: (m) => chrome.runtime.sendMessage(m),
    onMessage: (fn) => chrome.runtime.onMessage.addListener((m, _s, respond) => fn(m, respond) === true),
    mountStage: async (d, a) => mountStage(d, { sprites: await loadSprites(a), iconUrl: a.icon }),
    // content-start.js leaves a live record of this build at document_start, right before it sends page-loaded.
    // Without one, this document's start was never seen (injected into a tab open before install or update), so its
    // typing is unknown and the tab counts as typed in until it next loads a page. Only the top frame acts on it.
    typingUnknown: !isLive(g[START_KEY], build, document),
  });
}
