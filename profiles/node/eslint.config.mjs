import js from '@eslint/js';
import globals from 'globals';

/**
 * Generic Node >=22 lint baseline for Project Tracker adopters.
 *
 * Copy this file and add project-specific overrides (browser files, generated paths,
 * framework rules) below the base config. Do not add style rules that Prettier owns.
 */
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
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      'no-undef': 'error',
      'no-dupe-keys': 'error',
      'no-unreachable': 'error',
      'no-constant-condition': 'error',
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
      'no-var': 'error',
      'no-console': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    files: ['test/**/*.{js,mjs,cjs}', '**/*.test.{js,mjs,cjs}'],
    languageOptions: { globals: { ...globals.node } },
  },
];
