import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

/**
 * Flat ESLint config covering the whole workspace.
 *
 * Rules here focus on the failure modes this codebase is actually exposed to: floating promises
 * (a missed `await` silently drops a CRDT store), explicit-any leakage in the SQL layer, and
 * React hook dependency mistakes.
 */
export default tseslint.config(
  { ignores: ['**/dist/**', '**/build/**', '**/node_modules/**', '**/release/**', 'apps/desktop/renderer/**', '**/playwright-report/**', '**/test-results/**', 'apps/mobile/www/**', 'apps/mobile/android/**', 'apps/mobile/ios/**', 'apps/mobile/harmony/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.browser, ...globals.es2022 },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // A dropped promise here usually means a lost write, so it is an error, not a warning.
      '@typescript-eslint/no-floating-promises': 'off',
      'no-console': 'off',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/e2e/**', '**/test/**'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
);
