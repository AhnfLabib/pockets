import { test, expect } from './fixtures';

test('working mode in the popup sets and clears the toolbar badge', async ({ context, worker }) => {
  const id = new URL(worker.url()).host;
  const page = await context.newPage();
  await page.goto(`chrome-extension://${id}/popup.html`);
  const badge = () => worker.evaluate(() => chrome.action.getBadgeText({}));
  expect(await badge()).toBe('');

  await page.getByRole('switch').check();
  await expect(page.locator('.state')).toHaveText('Working');
  await expect.poll(badge).toBe(' ');
  expect(await worker.evaluate(() => chrome.action.getBadgeBackgroundColor({}))).toEqual([217, 72, 59, 255]);

  await page.getByRole('switch').uncheck();
  await expect(page.locator('.state')).toHaveText('Not working');
  await expect.poll(badge).toBe('');
});
