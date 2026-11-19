// Content script entry (content.js): wires the real chrome APIs into the host logic.
//
// It may run twice in one frame (declared in the manifest, and injected by the background into tabs open before
// install or update), so it first claims the frame (guard.ts); a second run of the same live build does nothing.
// Imports are hoisted above this code by the bundler; none of them touches the page when loaded.
import { mountStage } from '../stage/mount';
import { startContent } from './host';
import { CONTENT_KEY, START_KEY, claim, contextProbe, isLive } from './guard';
import { buildStamp } from './stamp';

const g = globalThis as unknown as Record<string, unknown>;
const build = buildStamp();
const alive = contextProbe(chrome.runtime);
let handle: { dispose(): void } | null = null;

if (alive() && claim(g, CONTENT_KEY, { build, alive, dispose: () => handle?.dispose() })) {
  handle = startContent({
    win: window,
    doc: document,
    assetBase: chrome.runtime.getURL('assets/'),
    iconUrl: chrome.runtime.getURL('assets/icons/icon-32.png'),
    sendMessage: (m) => chrome.runtime.sendMessage(m),
    onMessage: (fn) => chrome.runtime.onMessage.addListener((m, _s, respond) => fn(m, respond) === true),
    mountStage: (d, base) => mountStage(d, base),
    // content-start.js leaves a live record of this build at document_start, right before it sends page-loaded.
    // Without one, this document's start was never seen (injected into a tab open before install or update), so its
    // typing is unknown and the tab counts as typed in until it next loads a page. Only the top frame acts on it.
    typingUnknown: !isLive(g[START_KEY], build),
  });
}
