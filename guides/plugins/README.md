# Плагины

Плагин расширяет HTTP-конвейер клиента обёртками вокруг запросов и ответов. Одна установка
действует на все ресурсы:

```ts
import { ItdClient } from 'itd-api';
import { crypt } from '@itd-api/crypto';

const itd = new ItdClient({ auth: token });
itd.use(crypt());
```

Нормализованные события проходят через отдельную цепочку `stream.use()`. Объект, который
реализует `ClientPlugin` и `EventMiddlewareObject`, нужно отдельно подключить к клиенту
и потоку событий.

## Cache

```bash
npm install @itd-api/cache
```

```ts
import { cache } from '@itd-api/cache';

const cached = cache({
  ttl: 60_000,
  operations: ['users.get', 'posts.get', 'posts.list'],
});

itd.use(cached);
```

Плагин хранит успешные ответы в LRU-кэше и объединяет одновременные одинаковые запросы.
Операции выбираются явно; после мутаций связанные данные инвалидируются автоматически.
У каждого клиента и аккаунта свой раздел кэша, а изменения общих сущностей сбрасывают
соответствующие операции во всех разделах.

```ts
await itd.posts.get(postId, { extensions: { cache: 'reload' } });
cached.invalidate('posts.get');
```

Полный каталог операций, подключение к нескольким клиентам и привязка к событиям описаны в
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

const crypto = crypt();
itd.use(crypto);
itd.notifications.events.use(crypto);

const created = await itd.posts.create(
  { content: 'секретный текст' },
  { extensions: { crypto: { encrypt: { cipher: 'invisible', cover: 'обычный пост' } } } },
);

const post = await itd.posts.get(created.id);
console.log(post.content);      // обложка
console.log(post.secret?.text); // секретный текст
```

Плагин обрабатывает посты, комментарии, ответы, текстовые поля профиля и превью уведомлений.
Промежуточный обработчик событий расшифровывает те же поля в нормализованных
обновлениях. Доступны `invisible` и `beecrypt`; ограничения описаны в README пакета.

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
- изменить нормализованный результат публичного метода;
- вернуть результат без обращения к сети;
- выбросить собственную ошибку.

`operationId` и HTTP-метод изменять нельзя: их задаёт операция. Для другого действия модуль
или ресурс должен запустить отдельную операцию.

`next()` возвращает тот же предметный результат, что и метод клиента: например,
`itd.notifications.list()` отдаёт плагину `Page<Notification>`, а не исходный объект сервера.
Если обёртка не вызывает `next()`, возвращённое ею значение считается готовым результатом и
повторно не преобразуется. Сырые `Response` доступны только транспортным перехватчикам.

`next()` можно вызвать только один раз. Повторный вызов завершает операцию ошибкой с именем
плагина.

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
    get(operationId: OperationId): OperationMetadata | undefined;
    use(transformer: OperationTransformer): Unsubscribe;
  };
  attempts: {
    use(interceptor: AttemptInterceptor): Unsubscribe;
  };
}
```

`operations.get()` возвращает публичные метаданные операции: HTTP-метод, политику повторов,
бакет и `OperationAnnotations`. Это расширяемый тип: плагин добавляет в него своё поле,
а подключаемый модуль заполняет поле через `annotations` в описании операции.

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

## Перехватчики отдельных попыток

`operations.use()` видит логическую операцию один раз. Для сетевых метрик, подписи запроса
и диагностических заголовков используется `attempts.use()` — отдельно для каждой попытки:

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

Перехватчик получает готовый URL, изменяемые заголовки, подготовленное тело, сигнал и номер
попытки. Параметры логической операции здесь изменить нельзя. `next()` можно вызвать один
раз. Чтобы завершить попытку без запроса, верните созданный вручную `Response`.

| Интерфейс | Частота | Результат без `next()` | Готовый URL |
| --- | ---: | --- | --- |
| `OperationTransformer` | один раз на операцию | готовый результат метода | обычно нет |
| `AttemptInterceptor` | каждая сетевая попытка | только `Response` | да |
| Транспорт | каждая сетевая попытка | не поддерживается | да |

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

Новые запросы перестают видеть плагин сразу. Функция очистки ждёт активные обёртки не дольше
`shutdownTimeout`; её собственное выполнение ограничено оставшимся временем. При превышении
срока `unuse()` и `dispose()` отклоняются с `ItdStateError`.
Обязательную зависимость нельзя отключить раньше зависящего от неё плагина.

`close()` по-прежнему временно останавливает очередь и события, не отключая плагины.
`dispose()` окончательно освобождает клиент и вызывает функции очистки плагинов изнутри
наружу. После него новые запросы и `use()` завершаются с `ItdStateError`. Накопленная
телеметрия отправляется до отключения плагинов. `await using` вызывает `dispose()` автоматически.

## Настройки запроса плагина

Плагин расширяет `RequestExtensions` в собственном пространстве имён. Отдельно
регистрировать ключ не нужно:

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
от расширений. Каждый пакет использует отдельное именованное поле и получает его в
`OperationTransformer`.

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
- [Порядок выполнения запроса](../reference/request-pipeline.md)
- [Методы плагинов у `ItdClient`](../reference/client.md#методы)
- [Плагины нескольких аккаунтов](../reference/accounts.md#методы)
