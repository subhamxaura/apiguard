import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: [
        'dist/**',
        'scripts/**',
        'tests/fixtures/**',
        // github/action-entry.ts is exercised via the e2e harness (vitest.e2e.config.ts),
        // not the unit/integration suite — documented reason per spec §20.1.
        'src/github/action-entry.ts',
      ],
      thresholds: {
        statements: 90,
        lines: 90,
        functions: 90,
        branches: 85,
      },
    },
  },
});
