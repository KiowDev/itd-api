import { defineConfig } from 'tsup';

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

  // Зависимости не вшиваются в бандл: undici крупный, а его версия должна совпадать
  // с той, что даёт глобальный fetch среды.
  external: ['undici', 'socks'],
});
