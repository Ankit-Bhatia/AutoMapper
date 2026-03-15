import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', '../packages/connectors/**/__tests__/**/*.test.ts'],
    setupFiles: ['src/__tests__/setupEnv.ts'],
    globalSetup: ['src/__tests__/globalSetup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/services/**/*.ts'],
      reporter: ['text', 'lcov'],
    },
  },
});
