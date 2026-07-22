import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Тесты поднимают настоящий `ItdClient` с подставным `fetch`: плагин имеет смысл
  // проверять только вместе с транспортом, через который он работает.
  resolve: {
    alias: {
      'itd-api': fileURLToPath(new URL('../src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
