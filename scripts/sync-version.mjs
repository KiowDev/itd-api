#!/usr/bin/env node
/**
 * Синхронизирует `src/core/version.ts` с версией из `package.json`.
 *
 * Версия нужна в рантайме — она уходит в `User-Agent`, — но импортировать `package.json`
 * из исходников нельзя: он оказался бы вне `rootDir`, попал бы в бандл целиком и сломал бы
 * проверку типов пакета. Поэтому единственное число хранится в `package.json`, а этот скрипт
 * порождает из него модуль.
 *
 * Вызывается автоматически: из `npm version` (до создания коммита) и перед сборкой.
 * Рассинхрон дополнительно ловит `test/version.test.ts`.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'src', 'core', 'version.ts');

const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));

const contents = `// Этот файл создаётся автоматически: scripts/sync-version.mjs.
// Менять вручную не нужно — значение берётся из package.json при \`npm version\` и сборке.

/** Версия библиотеки. Попадает в \`User-Agent\`. */
export const LIBRARY_VERSION = '${version}';
`;

const existing = await readFile(target, 'utf8').catch(() => '');

if (existing === contents) {
  console.log(`src/core/version.ts уже соответствует версии ${version}`);
} else {
  await writeFile(target, contents, 'utf8');
  console.log(`src/core/version.ts обновлён до версии ${version}`);
}
