import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      'itd-api': fileURLToPath(new URL('../../src/index.ts', import.meta.url)),
      '@itd-api/cache': fileURLToPath(new URL('../cache/src/index.ts', import.meta.url)),
      '@itd-api/crypto': fileURLToPath(new URL('../crypto/src/index.ts', import.meta.url)),
      '@itd-api/testing': fileURLToPath(new URL('../testing/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
