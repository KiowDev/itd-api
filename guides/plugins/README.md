# Плагины

Плагин расширяет клиент обёртками вокруг запросов и ответов. Одна установка действует на
все ресурсы:

```ts
import { ItdClient } from 'itd-api';
import { crypt } from '@itd-api/crypto';

const itd = new ItdClient({ auth: token });
itd.use(crypt());
```

## Cache

```bash
npm install @itd-api/cache
```

```ts
import { cache } from '@itd-api/cache';

const cached = cache({
  ttl: 60_000,
  routes: ['users.get', 'posts.get', 'posts.list'],
});

itd.use(cached);
```

Плагин хранит успешные ответы в LRU-кэше и объединяет одновременные одинаковые запросы.
Маршруты выбираются явно; после мутаций связанные данные инвалидируются автоматически.
У каждого клиента и аккаунта свой раздел кэша, а изменения общих сущностей сбрасывают
соответствующие маршруты во всех разделах.

```ts
await itd.posts.get(postId, { cache: 'reload' });
cached.invalidate('posts.get');
```

Полный каталог маршрутов, подключение к нескольким клиентам и привязка к realtime описаны в
[README пакета](../../packages/cache/README.md).

Запускаемый пример:

```bash
ITD_TOKEN=<accessToken> ITD_POST_ID=<postId> \
  node guides/plugins/examples/cache.mjs
```

## Crypto

```bash
npm install @itd-api/crypto
```

```ts
import { crypt } from '@itd-api/crypto';

itd.use(crypt());

const created = await itd.posts.create(
  { content: 'секретный текст' },
  { encrypt: { cipher: 'invisible', cover: 'обычный пост' } },
);

const post = await itd.posts.get(created.id);
console.log(post.content);      // обложка
console.log(post.secret?.text); // секретный текст
```

Плагин обрабатывает посты, комментарии, ответы и текстовые поля профиля. Доступны
`invisible` и `beecrypt`; подробные ограничения описаны в README пакета.

Запускаемый пример:

```bash
ITD_TOKEN=<accessToken> node guides/plugins/examples/crypto.mjs
```

## Собственный плагин

```ts
import type { ItdPlugin } from 'itd-api';

const timing: ItdPlugin = {
  name: 'timing',
  install({ use, logger }) {
    use(async (request, next) => {
      const started = Date.now();
      try {
        return await next(request);
      } finally {
        logger?.info(`${request.method} ${request.path}: ${Date.now() - started} мс`);
      }
    });
  },
};

itd.use(timing);
```

Обёртка может:

- передать в `next()` изменённую копию запроса;
- изменить полученный ответ;
- вернуть результат без обращения к сети;
- выбросить собственную ошибку.

Без явных правил подключённая раньше обёртка оказывается снаружи. Она выполняется один раз
на логический запрос, независимо от внутренних повторов транспорта.

## Порядок и зависимости

Плагин может описать отношения с другими плагинами:

```ts
const tracing: ItdPlugin = {
  name: 'tracing',
  before: ['cache'],       // обёртка tracing снаружи cache
  requires: ['transport'], // без transport подключение завершится ошибкой
  conflicts: ['legacy-tracing'],
  install({ use }) {
    use((request, next) => next(request));
  },
};
```

- `before` ставит плагин снаружи названных;
- `after` — внутри названных;
- `requires` требует уже подключённый плагин и ставит его раньше зависимого;
- `conflicts` запрещает совместное подключение, даже если конфликт объявлен только одной
  стороной.

Ссылки `before` и `after` на ещё не подключённый плагин допустимы: порядок перестроится,
когда тот появится. Цикл отклоняется до вызова `install()`.

Фактический порядок можно проверить:

```ts
itd.pluginNames();
itd.hasPlugin('cache');
```

## Хуки отдельных попыток

`use()` видит логический запрос один раз. Для метрик и трассировки есть `useHooks()`:

```ts
const telemetry: ItdPlugin = {
  name: 'telemetry',
  install({ useHooks }) {
    useHooks({
      onRequest({ method, path, attempt }) {
        console.log(`попытка ${attempt}: ${method} ${path}`);
      },
      onResponse({ status, duration }) {
        console.log(status, duration);
      },
      onError({ error, duration }) {
        console.error(error, duration);
      },
      onRetry({ attempt, delay }) {
        console.log(`после попытки ${attempt} ждём ${delay} мс`);
      },
    });
  },
};
```

Хуки, заданные в конструкторе `ItdClient`, вызываются раньше хуков плагинов. Исключение
из хука прерывает запрос — плагину наблюдаемости лучше обрабатывать собственные ошибки
внутри.

## Отключение и очистка

`install()` может вернуть синхронную или асинхронную функцию очистки:

```ts
const plugin: ItdPlugin = {
  name: 'connection',
  install({ use }) {
    const connection = openConnection();
    use((request, next) => next(request));

    return () => connection.close();
  },
};

itd.use(plugin);
await itd.unuse('connection');
```

Новые запросы перестают видеть плагин сразу, а teardown ждёт завершения запроса, который
уже проходит через его обёртку. Обязательную зависимость нельзя отключить раньше зависящего
от неё плагина.

`close()` по-прежнему временно останавливает очередь и realtime, не отключая плагины.
`dispose()` делает окончательную очистку и вызывает teardown всех плагинов изнутри наружу.
`await using` вызывает `dispose()` автоматически.

## Собственные опции метода

Плагин объявляет разрешённые ключи:

```ts
const plugin: ItdPlugin = {
  name: 'мой',
  optionKeys: ['мояОпция'],
  install({ use }) {
    use(async (request, next) => {
      console.log(request.мояОпция);
      return next(request);
    });
  },
};

declare module 'itd-api' {
  interface RequestOptions {
    мояОпция?: string | undefined;
  }
}
```

Ключи самого запроса — `path`, `body`, `headers`, `signal` и другие системные поля —
зарезервированы. Плагин с конфликтующим `optionKeys` отклоняется при подключении.

## Несколько аккаунтов

```ts
accounts.use(plugin);
await accounts.unuse(plugin.name);
```

Плагин установится всем существующим аккаунтам и будет автоматически применяться к новым.
`accounts.pluginNames()` и `accounts.hasPlugin()` описывают общий набор.

## Структура нового плагина

Структура пакета плагина:

```text
my-plugin/
├── package.json
├── README.md
├── src/
│   └── index.ts
└── test/
    └── plugin.test.ts
```

Пакет должен иметь собственные тесты, сборку и экспортировать фабрику либо объект,
совместимый с `ItdPlugin`.
