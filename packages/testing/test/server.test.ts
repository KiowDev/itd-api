import {
  type ClientPlugin,
  ItdClient,
  type NotificationEventContext,
  type NotificationEvents,
  NotificationUpdateType,
} from 'itd-api';
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  apiErrorResponse,
  createMockFetch,
  createMockServer,
  createTestClock,
  HttpMethod,
  sseResponse,
  waitForUpdate,
} from '../src/index.js';

const ALICE = '00000000-0000-4000-8000-000000000001';
const BOB = '00000000-0000-4000-8000-000000000002';
const CAROL = '00000000-0000-4000-8000-000000000003';

async function settleUntil(condition: () => boolean): Promise<void> {
  for (let index = 0; index < 30 && !condition(); index += 1) await Promise.resolve();
  if (!condition()) throw new Error('Условие не наступило');
}

function makeServer() {
  return createMockServer({
    clock: createTestClock('2026-08-01T10:00:00Z'),
    seed: {
      users: [
        { id: ALICE, username: 'alice', displayName: 'Алиса' },
        { id: BOB, username: 'bob', displayName: 'Боб' },
      ],
    },
  });
}

describe('createMockServer', () => {
  it('сохраняет флейвор контекста в waitForUpdate()', () => {
    const check = <C extends NotificationEventContext>(stream: NotificationEvents<C>) => {
      expectTypeOf(waitForUpdate(stream)).toEqualTypeOf<Promise<C>>();
    };

    expectTypeOf(check).returns.toEqualTypeOf<void>();
  });

  it('сохраняет mock-домен по умолчанию и нормализует пользовательский baseUrl', async () => {
    const defaultServer = createMockServer();
    const defaultClient = new ItdClient(defaultServer.clientOptions({ as: 'test-user-1' }));
    await defaultClient.users.me();
    expect(defaultServer.requests[0]?.url).toBe('https://mock.itd.test/api/users/me');

    const customServer = createMockServer({ baseUrl: 'https://custom.test/' });
    const customClient = new ItdClient(customServer.clientOptions({ as: 'test-user-1' }));
    await customClient.users.me();
    expect(customServer.requests[0]?.url).toBe('https://custom.test/api/users/me');
  });

  it('выполняет пользовательский сценарий в общем состоянии', async () => {
    const server = makeServer();
    const alice = new ItdClient(server.clientOptions({ as: 'alice' }));
    const bob = new ItdClient(server.clientOptions({ as: 'bob' }));

    await alice.users.follow('bob');
    const post = await bob.posts.create({ content: 'Проверяем сервер' });
    await alice.posts.like(post.id);
    const comment = await alice.posts.comment(post.id, 'Работает');

    expect((await bob.posts.get(post.id)).likesCount).toBe(1);
    expect((await bob.posts.comments(post.id)).items).toMatchObject([{ id: comment.id }]);
    expect((await bob.notifications.list()).items.map((item) => item.type)).toEqual([
      'post_comment',
      'post_reaction',
      'follow',
    ]);
    expect(await bob.notifications.count()).toBe(3);
    expect(server.snapshot().users.find((user) => user.id === ALICE)?.following).toEqual([BOB]);

    await bob.posts.remove(post.id);
    await expect(alice.posts.get(post.id)).rejects.toMatchObject({ status: 404 });
    await bob.posts.restore(post.id);
    await expect(alice.posts.get(post.id)).resolves.toMatchObject({ id: post.id });
    server.assertNoUnsupportedRequests();
  });

  it('доставляет действия сервера в связанный транспорт событий', async () => {
    const server = makeServer();
    const alice = new ItdClient(server.clientOptions({ as: 'alice' }));
    const transport = server.notificationEvents({ as: 'bob' });
    const bob = new ItdClient({
      ...server.clientOptions({ as: 'bob' }),
      events: { notifications: { transport, syncCount: false, jitter: 0 } },
    });
    const stream = bob.notifications.events;

    await stream.connect();
    await transport.waitForConnection(0);
    const update = waitForUpdate(stream);
    await alice.users.follow('bob');

    await expect(update).resolves.toMatchObject({
      update: { type: NotificationUpdateType.Notification },
    });
    await stream.drain();
    stream.disconnect();
  });

  it('проверяет настоящий разбор SSE без сети', async () => {
    const mock = createMockFetch();
    mock.get(
      '/api/notifications/stream',
      sseResponse([
        { event: 'notification', data: '{' },
        { event: 'unread_count', data: { payload: { count: 4 } } },
      ]),
    );
    const client = new ItdClient({
      baseUrl: 'https://mock.itd.test',
      fetch: mock.fetch,
      auth: 'test-token',
      retry: false,
      rateLimit: false,
      userAgent: false,
      events: {
        notifications: { transport: 'sse', syncCount: false, maxAttempts: 0 },
      },
    });
    const stream = client.notifications.events;
    const parseError = new Promise<{ raw: string }>((resolve) =>
      stream.once('parseError', resolve),
    );
    const update = waitForUpdate(stream);

    await stream.connect();
    await expect(parseError).resolves.toMatchObject({ raw: '{' });
    await expect(update).resolves.toMatchObject({
      update: { type: NotificationUpdateType.UnreadCount, data: 4 },
    });
    await stream.drain();
    stream.disconnect();
    mock.assertDone();
  });

  it('управляет переподключением через тестовые часы', async () => {
    const clock = createTestClock('2026-08-01T10:00:00Z');
    const server = createMockServer({
      clock,
      seed: { users: [{ id: ALICE, username: 'alice' }] },
    });
    const transport = server.notificationEvents({ as: 'alice' });
    const client = new ItdClient({
      ...server.clientOptions({ as: 'alice' }),
      events: {
        notifications: { transport, syncCount: false, backoff: [100], jitter: 0 },
      },
    });
    const stream = client.notifications.events;

    await stream.connect();
    await transport.waitForConnection(0);
    const reconnected = transport.waitForConnection(1);
    transport.close();
    await settleUntil(() => clock.pending === 1);
    await clock.advanceBy(100);
    await reconnected;

    expect(transport.connections).toBe(2);
    stream.disconnect();
  });

  it('управляет повтором по HTTP-дате Retry-After через тестовые часы', async () => {
    const clock = createTestClock(0);
    const server = createMockServer({
      clock,
      seed: { users: [{ id: ALICE, username: 'alice' }] },
    });
    server.failNext(
      HttpMethod.Get,
      '/api/users/me',
      apiErrorResponse(429, 'RATE_LIMIT_EXCEEDED', 'Повторите запрос позже', {
        headers: { 'Retry-After': new Date(5_000).toUTCString() },
      }),
    );
    const client = new ItdClient({
      ...server.clientOptions({ as: 'alice' }),
      timeout: 0,
      retry: { attempts: 2, jitter: 0, maxDelay: 10_000 },
    });

    const profile = client.users.me();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await settleUntil(() => clock.pending === 1);
    await clock.advanceBy(4_999);
    expect(server.requests).toHaveLength(1);
    await clock.advanceBy(1);

    await expect(profile).resolves.toMatchObject({ id: ALICE });
    expect(server.requests).toHaveLength(2);
  });

  it('видит запрос после преобразования плагином и допускает расширение маршрутов', async () => {
    const server = makeServer();
    const plugin: ClientPlugin = {
      name: 'test-header',
      install({ operations }) {
        operations.use((request, next) =>
          next({ ...request, headers: { ...request.headers, 'X-Plugin': 'active' } }),
        );
      },
    };
    const client = new ItdClient(server.clientOptions({ as: 'alice' }));
    client.use(plugin);
    await client.users.me();
    expect(server.requests[0]?.headers['x-plugin']).toBe('active');

    const remove = server.override(HttpMethod.Get, '/plugin/status', (request) =>
      apiResponse({ plugin: request.headers.get('x-plugin') }),
    );
    await expect(
      client.request({ method: HttpMethod.Get, path: '/plugin/status' }),
    ).resolves.toEqual({ plugin: 'active' });
    remove();
  });

  it('сохраняет плоский ответ списка уведомлений для raw-запросов и interceptor', async () => {
    const server = makeServer();
    const client = new ItdClient(server.clientOptions({ as: 'alice' }));
    let hookBody: unknown;
    client.use({
      name: 'response-reader',
      install({ attempts }) {
        attempts.use(async ({ url }, next) => {
          const response = await next();
          if (new URL(url).pathname === '/api/notifications/') {
            hookBody = await response.clone().json();
          }
          return response;
        });
      },
    });

    const raw = await client.request({
      method: HttpMethod.Get,
      path: '/api/notifications/',
      raw: true,
    });

    expect(raw).toEqual({ notifications: [], hasMore: false });
    expect(hookBody).toEqual(raw);
  });

  it('отправляет уведомление адресату ответа', async () => {
    const server = createMockServer({
      seed: {
        users: [
          { id: ALICE, username: 'alice' },
          { id: BOB, username: 'bob' },
          { id: CAROL, username: 'carol' },
        ],
        posts: [{ id: 'post-1', authorId: ALICE }],
        comments: [{ id: 'comment-1', postId: 'post-1', authorId: ALICE }],
      },
    });
    const alice = new ItdClient(server.clientOptions({ as: 'alice' }));
    const bob = new ItdClient(server.clientOptions({ as: 'bob' }));
    const carol = new ItdClient(server.clientOptions({ as: 'carol' }));

    await carol.comments.reply('comment-1', (comment) =>
      comment.content('Ответ Бобу').replyTo(BOB),
    );

    expect(await bob.notifications.count()).toBe(1);
    expect(await alice.notifications.count()).toBe(0);

    await carol.comments.reply('comment-1', 'Ответ Алисе');

    expect(await alice.notifications.count()).toBe(1);
  });

  it('не маскирует отсутствующие маршруты', async () => {
    const server = makeServer();
    const client = new ItdClient(server.clientOptions({ as: 'alice' }));
    await expect(
      client.request({ method: HttpMethod.Get, path: '/api/not-implemented' }),
    ).rejects.toMatchObject({ status: 501 });
    expect(() => server.assertNoUnsupportedRequests()).toThrow(/не реализует/);
  });

  it('проверяет связи в исходных данных до запуска теста', () => {
    expect(() =>
      createMockServer({
        seed: { posts: [{ authorId: 'missing', content: 'Некорректная запись' }] },
      }),
    ).toThrow(/нет автора missing/);
  });

  it.each([
    {
      name: 'реакция отсутствующего пользователя',
      seed: {
        users: [{ id: ALICE, username: 'alice' }],
        posts: [{ id: 'post-1', authorId: ALICE, likedBy: ['missing'] }],
      },
    },
    {
      name: 'повторяющееся имя пользователя',
      seed: {
        users: [
          { id: ALICE, username: 'same' },
          { id: BOB, username: 'same' },
        ],
      },
    },
    {
      name: 'повторяющийся идентификатор уведомления',
      seed: {
        users: [{ id: ALICE, username: 'alice' }],
        notifications: [
          { id: 'notification-1', userId: ALICE },
          { id: 'notification-1', userId: ALICE },
        ],
      },
    },
    {
      name: 'родительский комментарий другого поста',
      seed: {
        users: [{ id: ALICE, username: 'alice' }],
        posts: [
          { id: 'post-1', authorId: ALICE },
          { id: 'post-2', authorId: ALICE },
        ],
        comments: [
          { id: 'comment-1', postId: 'post-1', authorId: ALICE },
          {
            id: 'comment-2',
            postId: 'post-2',
            authorId: ALICE,
            parentCommentId: 'comment-1',
          },
        ],
      },
    },
  ])('отклоняет повреждённый seed: $name', ({ seed }) => {
    expect(() => createMockServer({ seed })).toThrow();
  });

  it('не изменяет состояние и исходный seed при ошибке reset()', () => {
    const server = makeServer();
    const before = server.snapshot();

    expect(() =>
      server.reset({
        users: [
          { id: ALICE, username: 'same' },
          { id: BOB, username: 'same' },
        ],
      }),
    ).toThrow();
    expect(server.snapshot()).toEqual(before);

    server.reset();
    expect(server.snapshot()).toEqual(before);
  });
});

function apiResponse(data: unknown): Response {
  return new Response(JSON.stringify({ data }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
