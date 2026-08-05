import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  target: 'es2022',
  platform: 'node',

  // При platform: 'node' tsdown по умолчанию даёт ESM расширение .mjs. Пакет уже
  // опубликован с `type: module` и путями на ./dist/index.js — оставляем их.
  fixedExtension: false,

  deps: {
    // Драйвер браузера подключается динамически и выбирается пользователем: playwright,
    // playwright-core, patchright — любой с тем же API. Бандлить его нельзя.
    neverBundle: ['patchright', 'playwright', 'playwright-core'],
  },
});
