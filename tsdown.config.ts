import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'rest/index': 'src/rest.ts',
    'realtime/index': 'src/realtime.ts',
    'node/index': 'src/node.ts',
    'web/index': 'src/web.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  target: 'es2022',
  platform: 'neutral',

  // Публичные subpath entry points повторяют структуру импортов, а автоматически
  // выделенные общие части не смешиваются с ними в корне dist/.
  outputOptions(options) {
    const chunkFileNames = options.chunkFileNames;
    return {
      ...options,
      chunkFileNames:
        typeof chunkFileNames === 'function'
          ? (chunk) => `shared/${chunkFileNames(chunk)}`
          : `shared/${chunkFileNames ?? '[name]-[hash].js'}`,
    };
  },

  // Общий код выносится в отдельный чанк: платформенные точки входа делят с основной
  // общие части (`MemoryTokenStorage`, разбор сессий), и без разделения каждая тянула бы
  // свою копию. В tsdown разделение включено всегда и отдельной опции не требует.

  deps: {
    // Обе зависимости вшиваются в бандл: для пользователя пакет остаётся zero-dependency.
    // Лицензии MIT продублированы в NOTICE.
    alwaysBundle: ['eventsource-parser', 'set-cookie-parser'],

    // Встроенные модули подключаются только динамически из src/node.ts.
    neverBundle: ['node:fs', 'node:fs/promises', 'node:path', 'node:stream'],
  },
});
