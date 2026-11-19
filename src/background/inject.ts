// Puts content.js into tabs that were already open when Pockets was installed or updated. Declared content scripts
// only reach documents that start after that, so without this such tabs could never host a visit until reloaded.
//
// Only content.js is injected, never content-start.js: the injected document did not load now, so no page-loaded is
// sent for it. content.js sees no document_start record of its build and reports the tab as typed in (host.ts,
// typingUnknown), so an injected tab is protected until it next loads a page. A tab where Pockets is already running
// is left as it was (the guard in content.js makes the second run a no-op, and it reports nothing).

/** The parts of a chrome.tabs.Tab the loop reads. */
export interface InjectTab { id?: number; url?: string; discarded?: boolean; status?: string }

export interface InjectApi {
  queryTabs(): Promise<InjectTab[]>;
  /** chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['content.js'] }). */
  injectContent(tabId: number): Promise<unknown>;
}

/** Only web pages: chrome://, the Web Store's chrome-extension pages, file:, data: and the like are skipped. A discarded
 *  or not-yet-loaded tab is skipped too: executeScript can resolve on one without running in a live document
 *  (docs/verification.md, test 5). */
export function injectable(t: InjectTab): t is InjectTab & { id: number } {
  if (typeof t.id !== 'number' || t.id < 0) return false;
  if (t.discarded || t.status === 'unloaded') return false;
  return typeof t.url === 'string' && /^https?:\/\//i.test(t.url);
}

/** Injects into every injectable tab at once (a slow page holds its injection until document_idle, so the tabs are
 *  not done one after another). A failure on one tab (a restricted page, an error page, a tab closed meanwhile) is
 *  ignored. Resolves with the ids whose injection resolved, for tests and logging; it never rejects. */
export async function injectIntoOpenTabs(api: InjectApi): Promise<number[]> {
  let tabs: InjectTab[];
  try {
    tabs = await api.queryTabs();
  } catch {
    return [];
  }
  const targets = tabs.filter(injectable);
  const results = await Promise.allSettled(targets.map((t) => api.injectContent(t.id)));
  return targets.flatMap((t, i) => (results[i].status === 'fulfilled' ? [t.id] : []));
}

export const chromeInjectApi: InjectApi = {
  queryTabs: () => chrome.tabs.query({}),
  injectContent: (tabId) => chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['content.js'] }),
};
