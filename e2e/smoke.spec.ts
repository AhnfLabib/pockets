import { test, expect } from './fixtures';

test('extension loads and the service worker answers ping', async ({ context, worker, server }) => {
  expect(worker.url()).toMatch(/^chrome-extension:\/\/[a-p]{32}\/background\.js$/);

  const extensionId = new URL(worker.url()).host;
  const page = await context.newPage();
  await page.goto(server.origin + '/smoke');

  // Content script: the worker messages the tab and expects the content stub to answer.
  const reply = await worker.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ url: url + '*' });
    for (let i = 0; i < 50; i++) {
      try {
        return await chrome.tabs.sendMessage(tab.id!, { type: 'pockets/ping' });
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    return null;
  }, server.origin + '/smoke');
  expect(reply).toEqual({ type: 'pockets/pong', from: 'content' });

  // Background: an extension context (not the worker itself) messages the worker.
  const ext = await context.newPage();
  await ext.goto(`chrome-extension://${extensionId}/manifest.json`);
  const bg = await ext.evaluate(() => chrome.runtime.sendMessage({ type: 'pockets/ping' }));
  expect(bg).toEqual({ type: 'pockets/pong', from: 'background' });
});
