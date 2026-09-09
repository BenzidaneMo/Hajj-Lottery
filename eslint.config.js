import js from '@eslint/js'
import prettierConfig from 'eslint-config-prettier'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/generated/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettierConfig,
  {
    // An `_` prefix marks a parameter that exists only to satisfy a signature
    // — Express error handlers, for instance, must take all four arguments.
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['client/**/*.{ts,tsx}'],
    languageOptions: {
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    // Two places where Fast Refresh has nothing to preserve, so the rule only
    // produces noise:
    //
    //   `routes/index.tsx` is a routing manifest. Its `lazy()` bindings are
    //   route targets, not components this file renders — the console is
    //   code-split so the citizen pages never download it.
    //
    //   `components/shadcn/` is vendored upstream source. Exporting a `cva`
    //   variant table beside its component is shadcn's own convention, and
    //   editing generated files to satisfy a dev-server nicety would make
    //   every future `shadcn add` a merge conflict.
    files: ['client/src/routes/index.tsx', 'client/src/components/shadcn/**/*.tsx'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
  {
    files: ['server/**/*.ts', 'shared/**/*.ts', 'prisma/**/*.{js,mjs,ts}', '*.config.{js,ts}'],
    languageOptions: {
      globals: globals.node,
    },
  },
)
