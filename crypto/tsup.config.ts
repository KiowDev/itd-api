import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  target: 'es2022',
  platform: 'neutral',

  // Сам клиент в бандл не попадает: пакет — плагин к нему, а не его копия. Из `itd-api`
  // берутся только типы, поэтому в собранном коде импорта не остаётся вовсе.
  external: ['itd-api'],
});
