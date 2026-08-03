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
await itd.posts.get(postId, { extensions: { cache: 'reload' } });
cached.invalidate('posts.get');
```

Полный каталог маршрутов, подключение к нескольким клиентам и привязка к realtime описаны в
[странице пакета](/packages/cache).

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
  { extensions: { crypto: { encrypt: { cipher: 'invisible', cover: 'обычный пост' } } } },
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
import type { ClientPlugin } from 'itd-api';

const timing: ClientPlugin = {
  name: 'timing',
  install({ operations, logger }) {
    operations.use(async (request, next) => {
      const started = Date.now();
      try {
        return await next(request);
      } finally {
        logger?.info(`${request.operationId}: ${Date.now() - started} мс`);
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

Основные публичные типы:

```ts
type OperationTransformer = (
  request: OperationRequestOptions,
  next: (request: OperationRequestOptions) => Promise<unknown>,
) => Promise<unknown>;

type AttemptInterceptor = (
  context: AttemptContext,
  next: () => Promise<Response>,
) => Promise<Response>;

type PluginTeardown = () => void | Promise<void>;

interface AuthIdentity {
  userId?: UserId;
  sessionId?: string;
}

interface PluginApi {
  baseUrl: string;
  logger: Logger | undefined;
  getAuthScope?: () => string;
  getAuthIdentity?: () => Promise<AuthIdentity>;
  operations: {
    use(transformer: OperationTransformer): Unsubscribe;
  };
  attempts: {
    use(interceptor: AttemptInterceptor): Unsubscribe;
  };
}
```

Без явных правил подключённая раньше обёртка оказывается снаружи. Она выполняется один раз
на логический запрос, независимо от внутренних повторов транспорта.

## Порядок и зависимости

Плагин может описать отношения с другими плагинами:

```ts
const tracing: ClientPlugin = {
  name: 'tracing',
  before: ['cache'],       // обёртка tracing снаружи cache
  requires: ['transport'], // без transport подключение завершится ошибкой
  conflicts: ['legacy-tracing'],
  install({ operations }) {
    operations.use((request, next) => next(request));
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

## Interceptors отдельных попыток

`operations.use()` видит логическую операцию один раз. Для метрик, wire logging, подписи
запроса и diagnostic headers используется `attempts.use()` — заново для каждой попытки:

```ts
const telemetry: ClientPlugin = {
  name: 'telemetry',
  install({ attempts }) {
    attempts.use(async ({ operationId, url, headers, attempt }, next) => {
      const started = performance.now();
      headers.set('X-Attempt-Trace', `${operationId}:${attempt}`);
      try {
        const response = await next();
        console.log(url, response.status, performance.now() - started);
        return response;
      } catch (error) {
        console.error(url, error, performance.now() - started);
        throw error;
      }
    });
  },
};
```

Interceptor получает уже разрешённый URL, итоговые mutable-заголовки, подготовленное тело,
сигнал и номер попытки. Семантический request здесь изменить нельзя. `next()` разрешено
вызвать ровно один раз: retry остаётся обязанностью core. Для явного short-circuit верните
синтетический `Response`, не вызывая `next()`.

`ClientHooks` в конструкторе остаются клиентским lifecycle API, включая `onRetry`; они не
являются plugin extension point и вызываются перед attempt chain там, где это применимо.

| Контракт | Частота | Результат | Short-circuit | Resolved URL |
| --- | ---: | --- | --- | --- |
| `OperationTransformer` | один раз на операцию | разобранный | да, любым результатом | обычно нет |
| `AttemptInterceptor` | каждая transport attempt | сырой `Response` | да, только `Response` | да |
| Transport | каждая transport attempt | формирует | нет | да |

## Отключение и очистка

`install()` может вернуть синхронную или асинхронную функцию очистки:

```ts
const plugin: ClientPlugin = {
  name: 'connection',
  install({ operations }) {
    const connection = openConnection();
    operations.use((request, next) => next(request));

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

## Namespace настроек запроса

Плагин расширяет `RequestExtensions` своим namespace. Никакой отдельной регистрации ключа
во время выполнения не требуется:

```ts
const plugin: ClientPlugin = {
  name: 'мой',
  install({ operations }) {
    operations.use(async (request, next) => {
      console.log(request.extensions?.мой?.режим);
      return next(request);
    });
  },
};

declare module 'itd-api' {
  interface RequestExtensions {
    мой?: {
      режим?: string | undefined;
    };
  }
}

await itd.posts.get(postId, {
  extensions: { мой: { режим: 'подробный' } },
});
```

`RequestOptions` хранит системные параметры выполнения (`signal`, `timeout`, `retry`) отдельно
от расширений. Каждый пакет владеет явно названным namespace, не конкурирует с системными
полями запроса и получает его в operation transformer без фильтрации или списка строковых ключей.

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
совместимый с `ClientPlugin`.

## Связанные разделы

- [`@itd-api/cache`](/packages/cache)
- [`@itd-api/crypto`](/packages/crypto)
- [Методы плагинов у `ItdClient`](../reference/client.md#методы)
- [Плагины нескольких аккаунтов](../reference/accounts.md#методы)
