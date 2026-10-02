import { defineConfig } from 'vitest/config';

// Keep unit tests independent of the Wails/Vite development configuration,
// which reads host-specific paths that are irrelevant to pure runner tests.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globals: false
  }
});
