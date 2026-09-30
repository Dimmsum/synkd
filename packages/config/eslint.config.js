// Shared ESLint flat config. Packages re-export it from their own eslint.config.js.
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/database.types.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // NFR-SEC-11: logs must never contain titles, ping text or tokens, so keep logging deliberate.
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  prettier,
);
