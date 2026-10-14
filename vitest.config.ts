import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@wos/shared': resolve(__dirname, 'packages/shared/src/index.ts') } },
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/api/**/*.test.ts'],
    environment: 'node',
    pool: 'forks', // native modules (better-sqlite3, argon2) are safest in child processes
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
