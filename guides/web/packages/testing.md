# @itd-api/testing

`@itd-api/testing` позволяет проверять клиент, плагины и прикладные сценарии без
настоящего API и сетевых запросов. Пакет работает во всех средах основного клиента.

[Точные сигнатуры](/api/generated/testing/)

## Установка

```bash
npm install itd-api
npm install --save-dev @itd-api/testing
```

Поддерживается `itd-api >=0.5.0 <1.0.0`.

## Какой режим выбрать

| Задача | Средство |
|---|---|
| результат метода SDK без проверки HTTP-деталей | `createMockOperations()` |
| точная последовательность ответов, сетевой сбой, `401`, `429` или `5xx` | `createMockFetch()` |
| полный сценарий с несколькими клиентами и общими данными | `createMockServer()` |
| устойчивые модели для ответов и исходных данных | функции `*Fixture()` |
| проверка пауз, тайм-аутов и переподключения без ожидания | `createTestClock()` |
| доставка уведомлений и произвольных кадров realtime | `MockRealtimeTransport` |

## Моки логических операций

```ts
import { ItdClient } from 'itd-api';
import { createMockOperations, postFixture, userFixture } from '@itd-api/testing';

const mock = createMockOperations()
  .operation('users.me', userFixture({ username: 'alice' }))
  .sequence('posts.get', [postFixture({ id: 'first' }), postFixture({ id: 'second' })]);

const itd = new ItdClient({ auth: 'test-token' }).use(mock);
await itd.users.me();
await itd.posts.get('first');
await itd.posts.get('second');
mock.assertDone();
```

`createMockOperations()` является `ClientPlugin`: обработчик выбирается по стабильному
`operationId` и возвращает уже разобранный результат метода SDK. Он выполняется один раз
на логическую операцию, выше retry, auth recovery, очереди и transport. По умолчанию
незарегистрированная операция завершается `UnhandledOperationError`; для смешанного
сценария задайте `{ passthrough: true }`. История доступна в `mock.calls`, а
`assertDone()` проверяет обязательные последовательности.

Этот уровень подходит для прикладного кода. Когда нужно проверить HTTP-метод, URL, тело,
заголовки, повторы или ошибки транспорта, используйте `createMockFetch()` ниже.

## Сценарные ответы

```ts
import { ItdClient } from 'itd-api';
import {
  apiErrorResponse,
  apiResponse,
  commentFixture,
  createMockFetch,
  postFixture,
  userFixture,
} from '@itd-api/testing';

const mock = createMockFetch();
mock.get('/api/users/me', [
  apiErrorResponse(401, 'TOKEN_EXPIRED', 'Токен истёк'),
  apiResponse(userFixture({ username: 'alice' })),
]);

const itd = new ItdClient({
  baseUrl: 'https://mock.itd.test',
  fetch: mock.fetch,
  auth: 'test-token',
});

const profile = await itd.users.me();
mock.assertDone();
```

Ответы в массиве расходуются по порядку. `repeat: true` повторяет последний ответ после
завершения последовательности:

```ts
mock.get('/api/posts/:postId', apiResponse(postFixture()), { repeat: true });
```

Обработчик маршрута получает исходный `Request`, параметры пути и уже разобранное тело:

```ts
mock.post('/api/posts/:postId/comments', ({ params, json, headers }) => {
  return apiResponse(commentFixture({
    content: (json as { content: string }).content,
  }));
});
```

Дополнительные средства охватывают распространённые сбои:

- `networkError()` имитирует ошибку `fetch`;
- `delayedResponse()` отдаёт ответ после управляемой задержки;
- `hangingResponse` не завершается до отмены запроса и подходит для проверки тайм-аута;
- `sseResponse()` создаёт настоящий конечный поток Server-Sent Events для проверки
  разбора кадров и ошибочного JSON;
- `apiErrorResponse()` создаёт ошибочный ответ API;
- `jsonResponse()`, `textResponse()`, `binaryResponse()` и `emptyResponse()` создают
  ответы без дополнительной обёртки.

`mock.assertDone()` проверяет, что все конечные ответы использованы и неизвестных запросов
не было. Если маршрут действительно необязателен для сценария, передайте
`{ optional: true }` при регистрации.

## Безопасная история запросов

```ts
const last = mock.requests.at(-1);
console.log(last?.method, last?.path, last?.body);
```

В обработчик поступают исходные данные. В сохранённой истории автоматически скрываются:

- `Authorization`, `Cookie`, `Set-Cookie` и похожие заголовки;
- query-параметры и поля JSON/форм с именами `token`, `password`, `otp`, `turnstile`,
  `captcha` и `secret`;
- содержимое двоичного тела — сохраняется только размер.

Таким образом, сообщение упавшего теста не печатает токен или пароль.

## Сервер API в памяти

```ts
import { ItdClient } from 'itd-api';
import { createMockServer, createTestClock } from '@itd-api/testing';

const server = createMockServer({
  clock: createTestClock('2026-08-01T10:00:00Z'),
  seed: {
    users: [
      { id: 'user-alice', username: 'alice', displayName: 'Алиса' },
      { id: 'user-bob', username: 'bob', displayName: 'Боб' },
    ],
    posts: [
      { id: 'welcome', authorId: 'user-alice', content: 'Добро пожаловать' },
    ],
  },
});

const alice = new ItdClient(server.clientOptions({ as: 'alice' }));
const bob = new ItdClient(server.clientOptions({ as: 'bob' }));

await bob.users.follow('alice');
await bob.posts.like('welcome');
await bob.posts.comment('welcome', 'Прочитано');

expect((await alice.posts.get('welcome')).likesCount).toBe(1);
expect(await alice.notifications.count()).toBe(3);
```

`clientOptions()` возвращает готовые `baseUrl`, `fetch`, тестовый токен, часы и отключённые
по умолчанию повторы с очередью частоты. Если повторы нужны в конкретной проверке, задайте
их поверх результата:

```ts
const itd = new ItdClient({
  ...server.clientOptions({ as: 'alice' }),
  retry: { attempts: 2, baseDelay: 100, jitter: 0 },
});
```

При создании сервера и вызове `reset()` проверяются уникальность пользователей, записей,
комментариев и уведомлений, а также все связи между ними. Если исходные данные некорректны,
состояние сервера не изменяется.

Ответ на комментарий уведомляет пользователя из `replyToUserId`. Если адресат не указан,
уведомление получает автор родительского комментария.

Поддерживаются:

- свой и чужой профиль, обновление и деактивация;
- создание, чтение, изменение, удаление и восстановление записей;
- лента и стена с устойчивой курсорной пагинацией;
- комментарии, ответы, их изменение, удаление и восстановление;
- реакции на записи и комментарии;
- подписка и отписка;
- список, счётчик и отметка уведомлений прочитанными;
- несколько клиентов с одним состоянием;
- `snapshot()` для независимого снимка и `reset()` для возврата к исходным данным.

Сервер покрывает перечисленные выше пользовательские сценарии. Файлы, медиа, особенности
старых ответов и событийные API проверяются отдельными сценариями. Неизвестный маршрут
возвращает `501` и код `MOCK_ROUTE_NOT_IMPLEMENTED`; в конце теста можно вызвать
`server.assertNoUnsupportedRequests()`.

## Разовый сбой и собственный маршрут

```ts
server.failNext(
  HttpMethod.Post,
  '/api/posts',
  apiErrorResponse(429, 'RATE_LIMIT_EXCEEDED', 'Слишком много запросов'),
);

const remove = server.override(HttpMethod.Get, '/api/my-service/state', () =>
  apiResponse({ active: true }),
);

// ...проверка...
remove();
```

`failNext()` действует один раз и проверяется до всех остальных маршрутов. `override()`
имеет приоритет над встроенной логикой и возвращает функцию снятия обработчика.

## Плагины

Дополнительной настройки для плагинов нет. Цепочка клиента выполняется до `fetch`, поэтому:

- сервер и сценарный `fetch` получают запрос после преобразований плагина;
- плагин получает обычный ответ и может изменить его до передачи ресурсу;
- история видит каждую настоящую сетевую попытку, но не видит ответ, который плагин
  полностью вернул из своего кэша;
- хуки плагина вызываются для каждой попытки повтора как при работе с настоящим API.

Если плагин вводит свой маршрут или меняет формат тела так, что встроенная модель сервера
его больше не понимает, добавьте `override()`. Сам сервер не распознаёт плагины по имени:
он обрабатывает итоговый HTTP-запрос.

## Управляемое время

```ts
const clock = createTestClock('2026-08-01T10:00:00Z');
const itd = new ItdClient({
  fetch: mock.fetch,
  auth: 'test-token',
  clock,
  retry: { attempts: 2, baseDelay: 1_000, jitter: 0 },
});

const pending = itd.users.me();
// после получения первого ошибочного ответа:
await clock.advanceBy(1_000);
await pending;
```

Одни часы управляют HTTP-тайм-аутом, паузами повторов, очередью частоты, ожиданием опроса,
тайм-аутами SSE и переподключением realtime. Глобальные поддельные таймеры не нужны.
Для точной проверки паузы задавайте `jitter: 0`: стандартная настройка добавляет случайный
разброс.

## Realtime

```ts
const transport = server.realtime({ as: 'alice' });
const stream = alice.realtime({ transport, syncCount: false, jitter: 0 });

await stream.connect();
await transport.waitForConnection(0);

const next = waitForUpdate(stream);
await bob.posts.like('welcome');

const context = await next;
await stream.drain();
```

Связанный с сервером транспорт получает уведомления от поддерживаемых действий. Отдельный
`MockRealtimeTransport` позволяет вручную вызвать `ready()`, `notification()`,
`unreadCount()`, `message()`, `parseError()`, `fail()` и `close()`. После `fail()` часы
клиента управляют обычным переподключением потока. Если требуется проверить именно SSE,
зарегистрируйте `sseResponse()` в `createMockFetch()`; для тайм-аута рукопожатия используйте
`hangingResponse`.

## Заготовки данных

Функции `userFixture()`, `publicProfileFixture()`, `postFixture()`, `commentFixture()`,
`notificationFixture()`, `sessionFixture()` и `pageFixture()` возвращают полностью
типизированные значения с устойчивыми полями по умолчанию. Передавать нужно только важные
для проверки отличия. `jwtFixture()` и `accessTokenFixture()` создают синтаксически
корректные тестовые JWT, но не подписывают их настоящим ключом и не предназначены для
рабочей авторизации.
