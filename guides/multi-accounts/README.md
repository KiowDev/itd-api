# Несколько аккаунтов

`ItdAccounts` управляет именованными клиентами. У каждого аккаунта отдельные tokens, cookie
и `deviceId`, но сессии складываются в одно `MultiTokenStorage`.

```ts
import { ItdAccounts } from 'itd-api';
import { FileMultiTokenStorage } from 'itd-api/node';

const accounts = new ItdAccounts({
  storage: new FileMultiTokenStorage('./.itd-sessions.json'),
  rateLimit: { concurrency: 4 },
});

await accounts.restore();

if (!accounts.has('kiow')) {
  accounts.addAccount('kiow', {
    auth: { email, password, getTurnstileToken },
  });
}

const itd = accounts.account('kiow');
await itd.posts.create({ content: 'привет' });
await accounts.close();
```

Имя аккаунта локальное: сервер его не знает и библиотека не нормализует.

## Основные операции

| Метод | Назначение |
|---|---|
| `addAccount(name, options?)` | добавить аккаунт |
| `account(name)` | получить обычный `ItdClient` |
| `restore()` | восстановить аккаунты из хранилища |
| `removeAccount(name, { forget })` | убрать аккаунт и при необходимости забыть сессию |
| `has(name)`, `names()`, `size` | проверить состав |
| `use(plugin)` | подключить плагин существующим и будущим клиентам |
| `on(event, listener)` | слушать события всех аккаунтов |
| `close()` | закрыть все клиенты |

## Общие и личные настройки

Общие опции задаются контейнеру, личные — в `addAccount()`. `headers` и `services`
объединяются по ключам.

```ts
accounts.addAccount('первый', {
  auth: token1,
  fetch: proxyFetch('socks5://127.0.0.1:1080'),
});

accounts.addAccount('второй', {
  auth: token2,
  fetch: proxyFetch('socks5://127.0.0.1:1081'),
});
```

`auth` и `deviceId` нельзя задавать контейнеру: они принадлежат конкретному аккаунту.
Обычный `TokenStorage` здесь заменён общим `MultiTokenStorage`, поэтому личный `storage`
в `addAccount()` также запрещён.

## Очереди запросов

По умолчанию у каждого аккаунта отдельная очередь. Это соответствует лимитам по аккаунту
и не связывает клиентов, работающих через разные прокси.

Если общий IP сам становится ограничением, включите одну очередь:

```ts
const accounts = new ItdAccounts({
  storage,
  rateLimit: { concurrency: 4, rps: 8 },
  rateLimitScope: 'shared',
});
```

В shared-режиме параметры очереди берутся из контейнера. Личный `rateLimit` у аккаунта
запрещён, но `rateLimit: false` полностью выводит конкретный клиент из общей очереди.

## Собственное хранилище

Для нескольких аккаунтов нужен key-value backend с перечислением ключей:

```ts
import {
  createKeyValueStore,
  createMultiTokenStorage,
  type ItdSession,
  withCodec,
  withNamespace,
} from 'itd-api';

const raw = createKeyValueStore<string>({
  get: async (key) => (await redis.get(key)) ?? undefined,
  set: (key, value) => redis.set(key, value).then(() => undefined),
  delete: (key) => redis.del(key).then(() => undefined),
  keys: (prefix = '') => redis.scanIterator({ MATCH: `${prefix}*` }),
});

const backend = withCodec<ItdSession, string>(withNamespace(raw, 'itd'), {
  encode: JSON.stringify,
  decode: JSON.parse,
});
const storage = createMultiTokenStorage(backend);
```

## События

Контейнер добавляет имя аккаунта в полезную нагрузку:

```ts
accounts.on('authError', ({ account, error }) => {
  console.error(`[${account}]`, error);
});
```

Плагины, подключённые через `accounts.use(plugin)`, применяются ко всем существующим и
будущим клиентам. `await accounts.unuse(name)` отключает плагин у всех, а
`accounts.pluginNames()` показывает фактический общий порядок.

## Realtime

Каждый аккаунт держит своё SSE-соединение. Не открывайте поток автоматически всем, если
уведомления нужны только части аккаунтов.

## Запускаемый пример

```bash
ITD_TOKENS='бот-1=<accessToken>,бот-2=<accessToken>' \
  node guides/multi-accounts/examples/multi-accounts.mjs
```

Исходник: [`examples/multi-accounts.mjs`](https://github.com/KiowDev/itd-api/blob/main/guides/multi-accounts/examples/multi-accounts.mjs).

## Связанные разделы

- [Сессии и хранилища](../reference/storage.md)
- [Справочник `ItdAccounts`](../reference/accounts.md)
- [Авторизация и сессии](../authentication/)
- [Конфигурация очередей](../configuration/#очередь-и-rate-limiting)
