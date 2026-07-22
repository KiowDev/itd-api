import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  target: 'es2022',
  platform: 'node',

  // Драйвер браузера подключается динамически и выбирается пользователем: playwright,
  // playwright-core, patchright — любой с тем же API. Бандлить его нельзя.
  external: ['playwright', 'playwright-core'],
});
