#!/usr/bin/env node
/**
 * Проверяет внешний модуль по собранным точкам входа пакета.
 *
 * Обычные тесты направляют package-импорты на исходники, чтобы не зависеть от свежести
 * `dist`. Перед публикацией эта проверка, наоборот, разрешает импорты через `exports` в
 * `package.json` и собирает тот же ESM-граф, который получит потребитель.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rolldown } from 'rolldown';
import ts from 'typescript';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = resolve(ROOT, 'test/fixtures/public-feature.ts');
const ALLOWED_IMPORTS = new Set(['itd-api', 'itd-api/rest', 'itd-api/events']);
const PACKAGE_EXPORT_KEYS = new Map([
  ['itd-api', '.'],
  ['itd-api/rest', './rest'],
  ['itd-api/events', './events'],
]);

const source = readFileSync(FIXTURE, 'utf8');
const sourceFile = ts.createSourceFile(FIXTURE, source, ts.ScriptTarget.Latest, true);
const imports = [];
let hasComputedDynamicImport = false;
function collectImports(node) {
  if (
    (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
    node.moduleSpecifier &&
    ts.isStringLiteralLike(node.moduleSpecifier)
  ) {
    imports.push(node.moduleSpecifier.text);
  } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
    const specifier = node.arguments[0];
    if (node.arguments.length === 1 && specifier && ts.isStringLiteralLike(specifier)) {
      imports.push(specifier.text);
    } else {
      hasComputedDynamicImport = true;
    }
  }
  ts.forEachChild(node, collectImports);
}
collectImports(sourceFile);
if (hasComputedDynamicImport) {
  throw new Error('Проверочный модуль содержит динамический импорт с вычисляемым путём');
}
const forbidden = imports.filter((specifier) => !ALLOWED_IMPORTS.has(specifier));
if (forbidden.length > 0) {
  throw new Error(`Проверочный модуль содержит непубличные импорты: ${forbidden.join(', ')}`);
}

const packageJson = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
const publicEntries = new Map(
  [...PACKAGE_EXPORT_KEYS].map(([specifier, key]) => {
    const target = packageJson.exports?.[key]?.import?.default;
    if (typeof target !== 'string') {
      throw new Error(`В package.json отсутствует ESM-точка входа ${specifier}`);
    }
    return [specifier, resolve(ROOT, target)];
  }),
);
for (const [specifier, path] of publicEntries) {
  if (!path.startsWith(resolve(ROOT, 'dist'))) {
    throw new Error(`Точка входа ${specifier} разрешилась вне dist: ${path}`);
  }
}

const resolvedRuntimeImports = new Set();
const build = await rolldown({
  input: FIXTURE,
  platform: 'neutral',
  plugins: [
    {
      name: 'public-package-entry-points',
      resolveId(specifier) {
        const entry = publicEntries.get(specifier);
        if (entry !== undefined) resolvedRuntimeImports.add(specifier);
        return entry;
      },
    },
  ],
});

try {
  await build.generate({ format: 'esm' });
  for (const specifier of ['itd-api/rest', 'itd-api/events']) {
    if (!resolvedRuntimeImports.has(specifier)) {
      throw new Error(`ESM-сборка не разрешила публичный импорт ${specifier}`);
    }
  }
} finally {
  await build.close();
}

console.log('Проверочный модуль использует типы и ESM-код только из публичных точек входа.');
