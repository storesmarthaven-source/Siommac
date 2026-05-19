/**
 * eslint.config.mjs  —  Flat config (ESLint 9+)
 *
 * Covers src/ only (the Preact frontend).
 * The netlify/functions backend has its own separate tsconfig and is not
 * linted here — it would need @typescript-eslint with the backend tsconfig.
 *
 * Rules enforced:
 *   - TypeScript strict: no-any, no floating promises, no misused promises
 *   - Deprecated API guard: new code must not call apiAction()
 *   - Preact/React hooks rules
 *   - Import order (auto-fixable)
 */

import js              from '@eslint/js';
import tsPlugin        from '@typescript-eslint/eslint-plugin';
import tsParser        from '@typescript-eslint/parser';
import reactHooks      from 'eslint-plugin-react-hooks';
import importPlugin    from 'eslint-plugin-import';

export default [
  // ── Global ignores ──────────────────────────────────────────────────────────
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'netlify/**',
      'assets/**',          // legacy JS — not linted until ported
      '*.config.{js,ts,mjs}',
    ],
  },

  // ── Base JS rules ──────────────────────────────────────────────────────────
  js.configs.recommended,

  // ── TypeScript rules ───────────────────────────────────────────────────────
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: {
      '@typescript-eslint': tsPlugin,
      'react-hooks':        reactHooks,
      'import':             importPlugin,
    },
    languageOptions: {
      parser:        tsParser,
      parserOptions: {
        project:        './tsconfig.frontend.json',
        tsconfigRootDir: import.meta.dirname,
        ecmaVersion:    2020,
        sourceType:     'module',
      },
    },
    settings: {
      'import/resolver': {
        typescript: {
          project: './tsconfig.frontend.json',
        },
      },
    },
    rules: {
      // ── TypeScript ──────────────────────────────────────────────────────────
      ...tsPlugin.configs['strict-type-checked'].rules,
      ...tsPlugin.configs['stylistic-type-checked'].rules,

      // Allow void operator for intentional fire-and-forget (logger, analytics)
      '@typescript-eslint/no-confusing-void-expression': 'off',

      // Allow non-null assertions sparingly in component code (use judiciously)
      '@typescript-eslint/no-non-null-assertion': 'warn',

      // Require explicit return types on exported functions (catches API shape regressions)
      '@typescript-eslint/explicit-module-boundary-types': 'warn',

      // ── Hooks ───────────────────────────────────────────────────────────────
      ...reactHooks.configs.recommended.rules,

      // ── Deprecated API guard ────────────────────────────────────────────────
      // Prevents new code from calling the legacy apiAction() wrapper.
      // Use apiGet() / apiPost() / apiFetch() with typed REST paths instead.
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name:            '@lib/api',
              importNames:     ['apiAction'],
              message:
                'apiAction is deprecated. Use apiGet / apiPost / apiFetch with a typed REST path instead.',
            },
          ],
        },
      ],

      // ── Import order ────────────────────────────────────────────────────────
      'import/order': [
        'warn',
        {
          groups: [
            'builtin',
            'external',
            'internal',
            ['parent', 'sibling', 'index'],
            'type',
          ],
          pathGroups: [
            { pattern: '@cfg',      group: 'internal', position: 'before' },
            { pattern: '@cfg/**',   group: 'internal', position: 'before' },
            { pattern: '@lib/**',   group: 'internal', position: 'before' },
            { pattern: '@store',    group: 'internal', position: 'before' },
            { pattern: '@store/**', group: 'internal', position: 'before' },
            { pattern: '@shared/**',   group: 'internal' },
            { pattern: '@sections/**', group: 'internal' },
          ],
          pathGroupsExcludedImportTypes: ['type'],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
      'import/no-duplicates':     'error',
      'import/no-cycle':          'error',   // prevents circular dependency bugs

      // ── General quality ─────────────────────────────────────────────────────
      'no-console':               ['warn', { allow: ['warn', 'error'] }],
      'eqeqeq':                   ['error', 'always'],
      'prefer-const':             'error',
      'no-var':                   'error',
    },
  },
];
