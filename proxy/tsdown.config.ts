import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  target: 'es2022',
  // Пакет обращается к node:tls и диспетчерам undici — он заведомо серверный.
  platform: 'node',

  // При platform: 'node' tsdown по умолчанию даёт ESM расширение .mjs. Пакет уже
  // опубликован с `type: module` и путями на ./dist/index.js — оставляем их.
  fixedExtension: false,

  deps: {
    // Зависимости не вшиваются в бандл: undici крупный, а его версия должна совпадать
    // с той, что даёт глобальный fetch среды.
    neverBundle: ['undici', 'socks'],
  },
});
