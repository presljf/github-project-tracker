import globals from 'globals';
import baseline from './profiles/node/eslint.config.mjs';

/** Tracker OS self-lint: shared node baseline + repo-specific ignores/overrides. */
export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/.git/**',
      '**/generated/**',
      '**/.next/**',
      '**/out/**',
      'desktop/server/**',
      'desktop/.webpack/**',
      'desktop/out/**',
      'desktop/dist/**',
      '.data*/**',
      'test-results/**',
      'playwright-report/**',
    ],
  },
  ...baseline,
  {
    files: ['test/**/*.{js,mjs,cjs}', 'desktop/test/**/*.{js,mjs,cjs}', '**/*.test.{js,mjs,cjs}'],
    rules: { 'no-unused-vars': 'off' },
  },
  {
    files: ['test/**/*.{js,mjs,cjs}', '**/*.test.{js,mjs,cjs}'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['src/web/**/*.{js,mjs,cjs}'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ['desktop/test/e2e/**/*.{js,mjs,cjs}', 'test/e2e/**/*.{js,mjs,cjs}'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
];
