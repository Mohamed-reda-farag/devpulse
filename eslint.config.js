// @ts-check
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import { FlatCompat } from '@eslint/eslintrc';

// eslint-config-next doesn't ship a native flat-config export as of the
// version pinned here (see README.md's Phase 3 status note on why that
// version, not the newest) — FlatCompat is Next.js's own documented bridge
// for using a legacy shareable config's `extends` string from inside a
// flat eslint.config.js, resolving 'next/core-web-vitals' via the same
// `eslint-config-next` package-name convention the legacy string always
// used.
const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

export default [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'data/**',
      '.next/**',
      'coverage/**',
      // Next.js's own generated file — its triple-slash references are
      // required, not a style choice (see README.md's Phase 3 status note).
      'next-env.d.ts',
    ],
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        project: false,
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': 'off',
    },
  },
  // Phase 3: React/JSX + Next.js-specific rules (hooks, next/image, App
  // Router conventions), scoped to the new /app tree — the rest of the repo
  // (lib/scripts/tests) has no JSX and doesn't need these.
  ...compat.extends('next/core-web-vitals').map((config) => ({
    ...config,
    files: ['app/**/*.ts', 'app/**/*.tsx', 'middleware.ts'],
  })),
];
