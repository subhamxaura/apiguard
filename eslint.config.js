import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**', '**/*.snap', 'scripts/**/*.cjs'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/github/**', '**/reporters/**', '**/cli/**'],
              message:
                'core/ must stay pure: never import github/, reporters/, or cli/ (spec §5.3).',
            },
          ],
          paths: [
            {
              name: '@actions/core',
              message: 'GitHub-only dependency; not allowed outside src/github/.',
            },
            {
              name: '@actions/github',
              message: 'GitHub-only dependency; not allowed outside src/github/.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/**/*.ts', '!src/github/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@actions/core',
              message: 'GitHub-only dependency; not allowed outside src/github/.',
            },
            {
              name: '@actions/github',
              message: 'GitHub-only dependency; not allowed outside src/github/.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/github/**/*.ts'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
  {
    files: ['**/*.test.ts', 'tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
    },
  },
);
