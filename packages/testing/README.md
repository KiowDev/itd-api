# @itd-api/testing

Сценарные ответы, сервер API в памяти, заготовки данных и управляемый realtime для
тестирования [`itd-api`](https://github.com/KiowDev/itd-api) без сетевых запросов.

[Руководство](https://kiowdev.github.io/itd-api/packages/testing) ·
[API из TSDoc](https://kiowdev.github.io/itd-api/api/generated/testing/)

## Установка

```bash
npm install itd-api
npm install --save-dev @itd-api/testing
```

Поддерживается `itd-api >=0.5.0 <1.0.0`.

## Сервер с состоянием

```ts
import { ItdClient } from 'itd-api';
import { createMockServer } from '@itd-api/testing';

const server = createMockServer({
  seed: {
    users: [
      { id: 'user-alice', username: 'alice' },
      { id: 'user-bob', username: 'bob' },
    ],
  },
});

const alice = new ItdClient(server.clientOptions({ as: 'alice' }));
const bob = new ItdClient(server.clientOptions({ as: 'bob' }));

const post = await alice.posts.create({ content: 'Проверяем сценарий' });
await bob.posts.like(post.id);

expect((await alice.posts.get(post.id)).likesCount).toBe(1);
```

Оба клиента работают с одним состоянием. Сервер поддерживает профили, записи,
комментарии и ответы, реакции, подписки, уведомления, удаление и восстановление.
Неизвестный маршрут возвращает статус `501` с кодом `MOCK_ROUTE_NOT_IMPLEMENTED`.
Некорректные связи и повторяющиеся идентификаторы в `seed` отклоняются до изменения состояния.

## Сценарный fetch

```ts
import { ItdClient } from 'itd-api';
import { apiErrorResponse, apiResponse, createMockFetch, userFixture } from '@itd-api/testing';

const mock = createMockFetch();
mock.get('/api/users/me', [
  apiErrorResponse(503, 'TEMPORARY', 'Повторите запрос'),
  apiResponse(userFixture()),
]);

const itd = new ItdClient({ fetch: mock.fetch, auth: 'test-token' });
await itd.users.me();
mock.assertDone();
```

Маршруты принимают параметры вида `/api/posts/:postId`. Обработчик получает разобранные
query-параметры, заголовки, JSON, `FormData`, текст и двоичное тело. История в
`mock.requests` скрывает токены, cookie, пароли, OTP и Turnstile-токены.
`sseResponse()` создаёт настоящий поток Server-Sent Events для проверки SSE-разбора.

## Управляемое время и realtime

```ts
import { createTestClock, MockRealtimeTransport } from '@itd-api/testing';

const clock = createTestClock('2026-08-01T10:00:00Z');
const transport = new MockRealtimeTransport();

const itd = new ItdClient({ auth: 'test-token', clock });
const stream = itd.realtime({ transport, syncCount: false, jitter: 0 });
await stream.connect();
await transport.waitForConnection(0);

transport.unreadCount(3);
await stream.drain();

await clock.advanceBy(1_000); // повторы, тайм-ауты и переподключение без реального ожидания
```

Подробнее: [руководство по testing](https://kiowdev.github.io/itd-api/packages/testing).
