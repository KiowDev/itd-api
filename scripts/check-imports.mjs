#!/usr/bin/env node
/**
 * Сторож направления импортов между слоями `src/`.
 *
 * Слои задуманы однонаправленными: ядро исполняет запрос, домен описывает API итд.com,
 * ресурсы и realtime строятся поверх, а фасад клиента — единственный composition root.
 * Обратный импорт разрушает границу молча: TypeScript его пропускает, тесты — тоже,
 * а обнаруживается он только при попытке вынести слой в отдельный пакет.
 *
 * Запуск: `npm run check:layers`.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src');

/** Слой файла определяется по его пути внутри `src/`. Порядок важен: побеждает первое совпадение. */
const LAYERS = [
  ['core/', 'core'],
  ['domain/', 'domain'],
  ['types/', 'types'],
  ['models/', 'models'],
  ['resources/', 'resources'],
  ['builders/', 'builders'],
  ['realtime/', 'realtime'],
  ['spans/', 'spans'],
  ['notifications/', 'notifications'],
  ['client.ts', 'sdk'],
  ['accounts.ts', 'sdk'],
  ['options.ts', 'sdk'],
  ['index.ts', 'entry'],
  ['node.ts', 'entry'],
  ['web.ts', 'entry'],
];

/**
 * Куда слою ходить нельзя.
 *
 * Точки входа отсутствуют: они и есть место сборки всего вместе.
 */
const FORBIDDEN = {
  core: ['domain', 'models', 'resources', 'builders', 'realtime', 'spans', 'notifications', 'sdk'],
  domain: ['resources', 'builders', 'realtime', 'spans', 'notifications', 'sdk'],
  types: ['resources', 'builders', 'realtime', 'spans', 'notifications', 'sdk'],
  // Перечисления (`types/enums.ts`) сами ни от чего не зависят, поэтому модели их читают.
  models: ['core', 'domain', 'resources', 'builders', 'realtime', 'notifications', 'sdk'],
  resources: ['sdk'],
  builders: ['resources', 'realtime', 'sdk'],
  realtime: ['resources', 'builders', 'sdk'],
  // Разметка бросает типизированные ошибки ядра — это нисходящая зависимость.
  spans: ['domain', 'resources', 'realtime', 'sdk'],
  notifications: ['resources', 'sdk'],
};

/**
 * Границы внутри одного слоя, которые карта слоёв выразить не может.
 *
 * Сборка запроса не должна ссылаться на конкретную реализацию сессии, иначе та останется
 * достижимой из любого бандла, включая анонимный, и разделение окажется бумажным.
 * Ни TypeScript, ни тесты такой регресс не заметят — только эта проверка.
 */
const FORBIDDEN_EDGES = [
  {
    from: 'core/client-runtime.ts',
    to: 'core/auth.ts',
    reason: 'сессию подставляет вызывающий через фабрику AuthProvider',
  },
  {
    from: 'core/config.ts',
    to: 'core/storage.ts',
    reason: 'хранилищем владеет сессия, а не конфигурация исполнения',
  },
  {
    from: 'core/config.ts',
    to: 'core/session-options.ts',
    reason: 'настройки исполнения не знают про авторизацию',
  },
  {
    from: 'core/options.ts',
    to: 'core/session-options.ts',
    reason: 'RuntimeOptions и SessionOptions объединяет только sdk-слой',
  },
];

/**
 * Осознанные исключения. Каждое живёт до конкретного шага декомпозиции.
 *
 * `typeOnly: true` — ребро существует только в системе типов и стирается при сборке:
 * на граф выполнения и на размер бандла оно не влияет.
 */
const ALLOWED = [
  {
    from: 'core/client-runtime.ts',
    to: 'domain/',
    reason: 'composition root: единственное место, где ядро получает каталог операций',
  },
  {
    from: 'core/auth.ts',
    to: 'domain/operations.ts',
    reason: 'будущий @itd-api/auth стоит над ядром и знает эндпоинты авторизации итд.com',
  },
  {
    from: 'core/',
    to: 'domain/operations.ts',
    typeOnly: true,
    reason:
      'OperationId остаётся доменным union ради автодополнения; снимется, когда ядро ' +
      'станет generic по OperationId extends string',
  },
  {
    from: 'core/auth.ts',
    to: 'models/common.ts',
    typeOnly: true,
    reason: 'существующий долг: UserId ждёт переезда сессии в отдельный слой',
  },
  {
    from: 'core/time.ts',
    to: 'models/common.ts',
    typeOnly: true,
    reason: 'существующий долг: IsoDate ждёт переезда моделей в доменный слой',
  },
];

function listFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(full));
    else if (entry.name.endsWith('.ts')) files.push(full);
  }
  return files;
}

function layerOf(path) {
  for (const [prefix, layer] of LAYERS) if (path.startsWith(prefix)) return layer;
  return undefined;
}

/** Спецификаторы модулей вместе с признаком «только тип». */
function readEdges(source) {
  // Захватывается и `import ... from`, и реэкспорт `export ... from`; `import type` /
  // `export type` попадают в первую группу и отмечают ребро как стираемое.
  const pattern = /(?:^|\n)\s*(?:import|export)(\s+type)?\s[^;]*?from\s*['"]([^'"]+)['"]/g;
  const edges = [];
  for (const match of source.matchAll(pattern)) {
    edges.push({ specifier: match[2], typeOnly: match[1] !== undefined });
  }
  return edges;
}

/** Приводит относительный `./x.js` к пути внутри `src/`, как его видит слой. */
function targetOf(fromFile, specifier) {
  if (!specifier.startsWith('.')) return undefined;
  const absolute = resolve(dirname(join(SRC, fromFile)), specifier);
  return relative(SRC, absolute).replaceAll('\\', '/').replace(/\.js$/, '.ts');
}

function isAllowed(from, to, typeOnly) {
  return ALLOWED.some(
    (rule) =>
      from.startsWith(rule.from) && to.startsWith(rule.to) && (!rule.typeOnly || typeOnly),
  );
}

const violations = [];

for (const file of listFiles(SRC)) {
  const from = relative(SRC, file).replaceAll('\\', '/');
  const fromLayer = layerOf(from);
  if (fromLayer === undefined) continue;

  const forbidden = FORBIDDEN[fromLayer] ?? [];
  for (const { specifier, typeOnly } of readEdges(readFileSync(file, 'utf8'))) {
    const to = targetOf(from, specifier);
    if (to === undefined) continue;

    const edge = FORBIDDEN_EDGES.find((rule) => rule.from === from && rule.to === to);
    if (edge) {
      violations.push({ from, to, typeOnly, why: edge.reason });
      continue;
    }

    const toLayer = layerOf(to);
    if (toLayer === undefined || !forbidden.includes(toLayer)) continue;
    if (isAllowed(from, to, typeOnly)) continue;

    violations.push({
      from,
      to,
      typeOnly,
      why: `слою «${fromLayer}» запрещено импортировать «${toLayer}»`,
    });
  }
}

if (violations.length > 0) {
  console.error(`Нарушено направление импортов (${violations.length}):\n`);
  for (const v of violations) {
    const kind = v.typeOnly ? ' (только тип)' : '';
    console.error(`  ${v.from} → ${v.to}${kind}`);
    console.error(`    ${v.why}\n`);
  }
  console.error('Добавьте осознанное исключение в scripts/check-imports.mjs либо');
  console.error('переверните зависимость: слой ниже не должен знать о слое выше.');
  process.exit(1);
}

console.log('Направление импортов между слоями src/ не нарушено.');
