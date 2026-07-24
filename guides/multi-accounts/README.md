# Несколько аккаунтов

`ItdAccounts` управляет именованными клиентами. У каждого аккаунта отдельные tokens, cookie
и `deviceId`, но сессии складываются в одно `MultiTokenStorage`.

```ts
import { FileMultiTokenStorage, ItdAccounts } from 'itd-api/node';

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

Идентификатор профиля можно прочитать из JWT без запроса:

```ts
for (const [name, itd] of accounts) {
  console.log(name, await itd.getUserId());
}
```

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

Методы `MultiTokenStorage` получают имя аккаунта:

```ts
import { createMultiTokenStorage } from 'itd-api';

const storage = createMultiTokenStorage({
  get: async (account) =>
    JSON.parse((await redis.get(`itd:session:${account}`)) ?? 'null'),

  set: async (account, session) => {
    await redis.set(`itd:session:${account}`, JSON.stringify(session));
    await redis.sadd('itd:accounts', account);
  },

  clear: async (account) => {
    await redis.del(`itd:session:${account}`);
    await redis.srem('itd:accounts', account);
  },

  accounts: () => redis.smembers('itd:accounts'),
});
```

Список `accounts()` ведёт сам адаптер. По нему `restore()` узнаёт, какие аккаунты нужно
поднять после перезапуска.

## События

Контейнер добавляет имя аккаунта в полезную нагрузку:

```ts
accounts.on('authError', ({ account, error }) => {
  console.error(`[${account}]`, error);
});
```

Плагины, подключённые через `accounts.use(plugin)`, применяются ко всем существующим и
будущим клиентам.

## Realtime

Каждый аккаунт держит своё SSE-соединение. Не открывайте поток автоматически всем, если
уведомления нужны только части аккаунтов.

## Запускаемый пример

```bash
ITD_TOKENS='бот-1=<accessToken>,бот-2=<accessToken>' \
  node guides/multi-accounts/examples/multi-accounts.mjs
```

Исходник: [`examples/multi-accounts.mjs`](./examples/multi-accounts.mjs).
