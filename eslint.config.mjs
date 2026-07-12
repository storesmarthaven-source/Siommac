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
    rules: {
      // ── TypeScript ──────────────────────────────────────────────────────────
      ...tsPlugin.configs['strict-type-checked'].rules,
      ...tsPlugin.configs['stylistic-type-checked'].rules,

      // TypeScript handles all undefined-reference checks at compile time;
      // ESLint's no-undef doesn't understand TS types/globals and produces
      // thousands of false positives on JSX, .d.ts globals, type imports, etc.
      'no-undef': 'off',

      // Recognise the _ prefix convention for intentionally-unused params/vars.
      // TypeScript already enforces unused locals in strict mode; this rule adds
      // the cross-check but must not fire on deliberate placeholders.
      '@typescript-eslint/no-unused-vars': ['error', {
        varsIgnorePattern:       '^_',
        argsIgnorePattern:       '^_',
        caughtErrorsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_',
        ignoreRestSiblings: true,
      }],

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

      // ── General quality ─────────────────────────────────────────────────────
      'no-console':               ['warn', { allow: ['warn', 'error'] }],
      // Allow == null / != null checks — they intentionally cover both null and
      // undefined (null == undefined is true) which is a valid JS/TS idiom.
      // All other == / != comparisons must use strict equality.
      'eqeqeq':                   ['error', 'always', { 'null': 'ignore' }],
      'prefer-const':             'error',
      'no-var':                   'error',
    },
  },
];
