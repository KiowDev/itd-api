#!/usr/bin/env node
/**
 * Замеряет, сколько кода получает пользователь от каждой точки входа.
 *
 * Собирает маленькие приложения-образцы поверх **собранного `dist/`**, а не исходников:
 * ровно так их увидит bundler на стороне пользователя, вместе с итоговым делением на чанки
 * и tree shaking.
 *
 * Запуск: `npm run build && npm run measure:size`.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { rolldown } from 'rolldown';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

/**
 * Образцы использования.
 *
 * Каждый обращается к результату импорта, иначе bundler справедливо выбросит весь код
 * как недостижимый и замер потеряет смысл.
 */
const FIXTURES = [
  {
    name: 'sdk',
    hint: "import { ItdClient } from 'itd-api'",
    source: `
      import { ItdClient } from ${JSON.stringify(join(DIST, 'index.js'))};
      export const run = (token) => new ItdClient({ auth: token }).posts.list();
    `,
  },
  {
    name: 'rest',
    hint: "import { createRestClient } from 'itd-api/rest'",
    source: `
      import { createRestClient } from ${JSON.stringify(join(DIST, 'rest.js'))};
      export const run = (token) => createRestClient({ auth: token }).posts.list();
    `,
  },
  {
    name: 'realtime',
    // Своей точки входа у потока событий пока нет, поэтому он идёт из основной —
    // и платит за неё целиком. Эта строка и есть довод за отдельный `itd-api/realtime`.
    hint: "import { ItdRealtime } from 'itd-api' — своей точки входа нет",
    source: `
      import { ItdRealtime } from ${JSON.stringify(join(DIST, 'index.js'))};
      export const run = (deps) => new ItdRealtime(deps).connect();
    `,
  },
];

function kb(bytes) {
  return `${(bytes / 1024).toFixed(1)} kB`;
}

async function measure(fixture, dir) {
  const entry = join(dir, `${fixture.name}.js`);
  writeFileSync(entry, fixture.source, 'utf8');

  const build = await rolldown({ input: entry, platform: 'browser' });
  const { output } = await build.generate({ format: 'esm', minify: true });
  await build.close();

  const code = output
    .filter((chunk) => chunk.type === 'chunk')
    .map((chunk) => chunk.code)
    .join('');
  const bytes = Buffer.byteLength(code);
  const modules = output
    .filter((chunk) => chunk.type === 'chunk')
    .reduce((total, chunk) => total + Object.keys(chunk.modules ?? {}).length, 0);

  return {
    name: fixture.name,
    hint: fixture.hint,
    minified: bytes,
    gzip: gzipSync(code).length,
    brotli: brotliCompressSync(code).length,
    modules,
  };
}

const dir = mkdtempSync(join(tmpdir(), 'itd-measure-'));
try {
  const results = [];
  for (const fixture of FIXTURES) results.push(await measure(fixture, dir));

  const width = Math.max(...results.map((result) => result.name.length));
  console.log('Размер поставки по точкам входа\n');
  console.log(
    `  ${'точка'.padEnd(width)}  ${'minified'.padStart(10)}  ${'gzip'.padStart(9)}` +
      `  ${'brotli'.padStart(9)}  ${'модулей'.padStart(8)}`,
  );
  for (const result of results) {
    console.log(
      `  ${result.name.padEnd(width)}  ${kb(result.minified).padStart(10)}` +
        `  ${kb(result.gzip).padStart(9)}  ${kb(result.brotli).padStart(9)}` +
        `  ${String(result.modules).padStart(8)}`,
    );
  }

  const sdk = results.find((result) => result.name === 'sdk');
  const rest = results.find((result) => result.name === 'rest');
  if (sdk && rest) {
    const saved = sdk.gzip - rest.gzip;
    const share = ((saved / sdk.gzip) * 100).toFixed(0);
    console.log(`\n  rest против sdk: −${kb(saved)} gzip (−${share} %)`);
  }

  console.log('\n  Образцы:');
  for (const result of results) console.log(`    ${result.name} — ${result.hint}`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
