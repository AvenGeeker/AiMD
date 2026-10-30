import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // `sanitize.ts` needs a DOM; the rest of the suite is environment-agnostic.
    environment: 'jsdom',
    include: ['test/**/*.test.ts'],
    environmentOptions: {
      jsdom: { url: 'http://localhost/' },
    },
  },
});
