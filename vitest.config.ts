import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Контрактный тест внешнего модуля использует те же имена пакетов, что и потребитель.
  // Точные псевдонимы ведут к исходным точкам входа, чтобы обычный `npm test` не зависел от
  // наличия или свежести предварительно собранного dist/.
  resolve: {
    alias: [
      {
        find: /^itd-api\/events$/,
        replacement: fileURLToPath(new URL('./src/events.ts', import.meta.url)),
      },
      {
        find: /^itd-api\/rest$/,
        replacement: fileURLToPath(new URL('./src/rest.ts', import.meta.url)),
      },
      {
        find: /^itd-api$/,
        replacement: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      },
    ],
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/node.ts', 'src/types/**'],
    },
  },
});
