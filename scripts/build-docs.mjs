import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const typedoc = fileURLToPath(new URL('../node_modules/typedoc/bin/typedoc', import.meta.url));

const builds = [
  {
    name: 'itd-api',
    entryPoint: 'src/index.ts',
    tsconfig: 'tsconfig.json',
    out: 'guides/web/api/generated/core',
  },
  // `itd-api/events` остаётся отдельным облегчённым npm entry point, но все его публичные
  // символы реэкспортируются из `itd-api` и уже документируются основной сборкой TypeDoc.
  // Платформенные точки входа реализуют интерфейсы ядра и ссылаются на его типы.
  // Дублировать их описание здесь незачем: оно целиком лежит в наборе `itd-api`.
  {
    name: 'itd-api/node',
    entryPoint: 'src/node.ts',
    tsconfig: 'tsconfig.json',
    out: 'guides/web/api/generated/node',
    intentionallyNotExported: [
      'FileTransferMode',
      'ItdSession',
      'LazyFile',
      'MultiTokenStorage',
      'StreamFile',
      'TokenStorage',
    ],
  },
  {
    name: 'itd-api/web',
    entryPoint: 'src/web.ts',
    tsconfig: 'tsconfig.json',
    out: 'guides/web/api/generated/web',
    intentionallyNotExported: ['ItdSession', 'TokenStorage'],
  },
  {
    name: '@itd-api/testing',
    entryPoint: 'packages/testing/src/index.ts',
    tsconfig: 'packages/testing/tsconfig.json',
    out: 'guides/web/api/generated/testing',
  },
  {
    name: '@itd-api/hydrate',
    entryPoint: 'packages/hydrate/src/index.ts',
    tsconfig: 'packages/hydrate/tsconfig.json',
    out: 'guides/web/api/generated/hydrate',
  },
  {
    name: '@itd-api/cache',
    entryPoint: 'packages/cache/src/index.ts',
    tsconfig: 'packages/cache/tsconfig.json',
    out: 'guides/web/api/generated/cache',
  },
  {
    name: '@itd-api/crypto',
    entryPoint: 'packages/crypto/src/index.ts',
    tsconfig: 'packages/crypto/tsconfig.json',
    out: 'guides/web/api/generated/crypto',
  },
  {
    name: '@itd-api/proxy',
    entryPoint: 'packages/proxy/src/index.ts',
    tsconfig: 'packages/proxy/tsconfig.json',
    out: 'guides/web/api/generated/proxy',
  },
  {
    name: '@itd-api/captcha',
    entryPoint: 'packages/captcha/src/index.ts',
    tsconfig: 'packages/captcha/tsconfig.json',
    out: 'guides/web/api/generated/captcha',
    intentionallyNotExported: ['Mouse', 'ElementHandle', 'Route'],
  },
];

for (const build of builds) {
  const args = [
    typedoc,
    '--options',
    'typedoc.json',
    '--entryPoints',
    build.entryPoint,
    '--tsconfig',
    build.tsconfig,
    '--out',
    build.out,
    '--name',
    build.name,
  ];

  for (const symbol of build.intentionallyNotExported ?? []) {
    args.push('--intentionallyNotExported', symbol);
  }
  args.push(...(build.extraArgs ?? []));

  const result = spawnSync(process.execPath, args, {
    cwd: root,
    stdio: 'inherit',
  });

  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
