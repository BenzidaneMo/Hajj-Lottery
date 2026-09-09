import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Deliberately without `@vitejs/plugin-react`. Its only jobs are Fast Refresh
  // and the automatic JSX runtime; the first is meaningless in a test run and
  // the second is set below. Vitest bundles its own Vite, so passing the app's
  // plugin across that boundary is also a type mismatch nobody gains anything
  // by working around.
  test: {
    include: ['tests/**/*.test.tsx', 'tests/**/*.test.ts'],
    // The public pages are DOM-first: RTL direction, focus, printing, live
    // regions and reduced motion are all things a component test can only
    // assert against a document.
    environment: 'jsdom',
    setupFiles: ['tests/setup.ts'],
    globals: true,
  },
  // `client/tsconfig.json` is a solution file with no `compilerOptions`, so
  // esbuild finds no `jsx` setting to inherit and would fall back to the
  // classic runtime — which needs `React` in scope, and nothing in this
  // codebase imports it.
  esbuild: { jsx: 'automatic' },
})
