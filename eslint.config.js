// Flat ESLint config. Foundation baseline: recommended JS + TS rules.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'data/**',
      'recordings/**',
      'coverage/**',
      'output/**',
      '.qoder/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    rules: {
      // Unused args are common in interface-shaped seams during foundation.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Fixtures legitimately contain large literal data sets.
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    files: ['fixtures/**/*.ts', 'test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    // Node-executed helper scripts (.mjs) run outside the TS project.
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        console: 'readonly',
        fetch: 'readonly',
        process: 'readonly',
        setTimeout: 'readonly',
      },
    },
  },
);
