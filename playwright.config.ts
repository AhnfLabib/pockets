import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  // Extensions need a persistent profile each; keep runs serial and predictable.
  workers: 1,
  fullyParallel: false,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['json', { outputFile: 'test-results/results.json' }]],
  use: { trace: 'off' },
});
