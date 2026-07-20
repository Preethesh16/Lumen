import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Integration tests share one database, so they must not run concurrently.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
