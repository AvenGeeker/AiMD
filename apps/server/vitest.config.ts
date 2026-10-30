import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Integration tests need a live Postgres; they self-skip when it is unreachable.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    pool: 'forks',
    // CRDT/Yjs state is shared across tests in the same file; forks keep them isolated.
    fileParallelism: false,
  },
});
