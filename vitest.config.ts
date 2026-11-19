import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // No unit tests exist yet in Task 1; later tasks add them under tests/.
    passWithNoTests: true,
  },
});
