import { describe, it, expect, vi } from 'vitest';
import { injectIntoOpenTabs, injectable, type InjectTab } from '../../src/background/inject';

/** A fake chrome.tabs.query + chrome.scripting.executeScript. */
function fakeApi(tabs: InjectTab[], fail: (id: number) => boolean = () => false) {
  const executeScript = vi.fn(async (opts: { target: { tabId: number; allFrames: boolean }; files: string[] }) => {
    if (fail(opts.target.tabId)) throw new Error('Cannot access contents of the page');
    return [{ frameId: 0, result: undefined }];
  });
  return {
    executeScript,
    api: {
      queryTabs: async () => tabs,
      injectContent: (tabId: number) => executeScript({ target: { tabId, allFrames: true }, files: ['content.js'] }),
    },
  };
}

describe('injectIntoOpenTabs', () => {
  it('injects content.js into every frame of http(s) tabs only', async () => {
    const { api, executeScript } = fakeApi([
      { id: 1, url: 'https://a.test/', status: 'complete' },
      { id: 2, url: 'http://b.test/x', status: 'loading' },
      { id: 3, url: 'chrome://newtab/' },
      { id: 4, url: 'chrome-extension://abc/popup.html' },
      { id: 5, url: 'file:///tmp/x.html' },
      { id: 6, url: 'about:blank' },
      { id: 7, url: 'data:text/html,hi' },
      { id: 8 },
      { url: 'https://no-id.test/' },
    ]);
    expect(await injectIntoOpenTabs(api)).toEqual([1, 2]);
    expect(executeScript.mock.calls.map(([o]) => o)).toEqual([
      { target: { tabId: 1, allFrames: true }, files: ['content.js'] },
      { target: { tabId: 2, allFrames: true }, files: ['content.js'] },
    ]);
  });

  it('skips discarded and unloaded tabs (executeScript can resolve on them without running)', async () => {
    const { api, executeScript } = fakeApi([
      { id: 1, url: 'https://a.test/', discarded: true },
      { id: 2, url: 'https://b.test/', status: 'unloaded' },
      { id: 3, url: 'https://c.test/', status: 'complete', discarded: false },
    ]);
    expect(await injectIntoOpenTabs(api)).toEqual([3]);
    expect(executeScript).toHaveBeenCalledTimes(1);
  });

  it('swallows a failure on one tab and still injects the others', async () => {
    const { api, executeScript } = fakeApi(
      [{ id: 1, url: 'https://chromewebstore.google.com/' }, { id: 2, url: 'https://ok.test/' }, { id: 3, url: 'https://gone.test/' }],
      (id) => id !== 2,
    );
    await expect(injectIntoOpenTabs(api)).resolves.toEqual([2]);
    expect(executeScript).toHaveBeenCalledTimes(3);
  });

  it('does not wait for one slow tab before starting the others', async () => {
    let release!: () => void;
    const started: number[] = [];
    const api = {
      queryTabs: async () => [{ id: 1, url: 'https://slow.test/' }, { id: 2, url: 'https://fast.test/' }],
      injectContent: (id: number) => {
        started.push(id);
        return id === 1 ? new Promise<void>((r) => { release = r; }) : Promise.resolve();
      },
    };
    const done = injectIntoOpenTabs(api);
    await Promise.resolve();
    expect(started).toEqual([1, 2]);
    release();
    expect(await done).toEqual([1, 2]);
  });

  it('a failing tab query resolves to nothing instead of throwing', async () => {
    await expect(injectIntoOpenTabs({ queryTabs: async () => { throw new Error('x'); }, injectContent: vi.fn() })).resolves.toEqual([]);
  });

  it('injectable: case-insensitive scheme, no negative ids', () => {
    expect(injectable({ id: 1, url: 'HTTPS://A.TEST/' })).toBe(true);
    expect(injectable({ id: -1, url: 'https://a.test/' })).toBe(false);
    expect(injectable({ id: 1, url: 'ftp://a.test/' })).toBe(false);
  });
});
