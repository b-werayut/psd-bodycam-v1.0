import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'drizzle/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    // Part 2 §2.4 rule 5: the API process must never pull in worker modules.
    files: ['src/app.module.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/worker.module', '**/*.worker.module'],
              message: 'AppModule must not import worker modules (API/worker split).',
            },
          ],
        },
      ],
    },
  },
);
