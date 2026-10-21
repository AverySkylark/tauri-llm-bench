import { defineConfig } from 'vitest/config';

// Harness tests only; task suites run inside their own working copies.
export default defineConfig({
  test: { include: ['tests/**/*.test.ts'], setupFiles: ['tests/setup-hidden.ts'] },
});
