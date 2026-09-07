import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/global-setup.ts'],
    setupFiles: ['tests/setup.ts'],
    // The suite shares one PostgreSQL database and truncates between tests,
    // so files must not run concurrently.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
  resolve: {
    // Source uses NodeNext-style `./x.js` specifiers that resolve to `./x.ts`.
    extensions: ['.ts', '.js', '.json'],
  },
})
