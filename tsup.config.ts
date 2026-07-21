import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    node: 'src/node.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  // Общий код выносится в отдельный чанк: точка входа `itd-api/node` — надстройка
  // над основной, и без разделения она дублировала бы всю библиотеку целиком.
  splitting: true,
  target: 'es2022',
  platform: 'neutral',

  // Обе зависимости вшиваются в бандл: для пользователя пакет остаётся zero-dependency.
  // Лицензии MIT продублированы в NOTICE.
  noExternal: ['eventsource-parser', 'set-cookie-parser'],

  // node:fs подключается только динамически из src/node.ts и не должен попадать в основной бандл.
  external: ['node:fs', 'node:fs/promises', 'node:path'],
});
