import { type ClientPlugin, ItdClient } from 'itd-api';
import { describe, expect, it } from 'vitest';
import {
  apiErrorResponse,
  apiResponse,
  createMockServer,
  createTestClock,
  HttpMethod,
  ItdTestingError,
} from '../../src/index.js';
import { ALICE, BOB, makeServer, settleUntil } from './test-server.utils.js';

describe('createMockServer: жизненный цикл', () => {
  it('сохраняет mock-домен по умолчанию и нормализует пользовательский baseUrl', async () => {
    const defaultServer = createMockServer();
    const defaultClient = new ItdClient(defaultServer.clientOptions({ as: 'test_user_1' }));
    await defaultClient.users.me();
    expect(defaultServer.requests[0]?.url).toBe('https://mock.itd.test/api/users/me');

    const customServer = createMockServer({ baseUrl: 'https://custom.test/' });
    const customClient = new ItdClient(customServer.clientOptions({ as: 'test_user_1' }));
    await customClient.users.me();
    expect(customServer.requests[0]?.url).toBe('https://custom.test/api/users/me');
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
      name: 'имя пользователя, отличающееся только регистром',
      seed: {
        users: [
          { id: ALICE, username: 'same' },
          { id: BOB, username: 'SAME' },
        ],
      },
    },
    {
      name: 'имя пользователя неверного формата',
      seed: { users: [{ id: ALICE, username: 'with-dash' }] },
    },
    {
      name: 'имя, совпадающее с id другого пользователя',
      seed: {
        users: [
          { id: 'dave_id', username: 'dave' },
          { id: BOB, username: 'DAVE_ID' },
        ],
      },
    },
    {
      name: 'подписка на себя',
      seed: { users: [{ id: ALICE, username: 'alice', following: [ALICE] }] },
    },
    {
      name: 'ответ на ответ',
      seed: {
        users: [{ id: ALICE, username: 'alice' }],
        posts: [{ id: 'post-1', authorId: ALICE }],
        comments: [
          { id: 'root', postId: 'post-1', authorId: ALICE },
          { id: 'reply', postId: 'post-1', authorId: ALICE, parentCommentId: 'root' },
          { id: 'nested', postId: 'post-1', authorId: ALICE, parentCommentId: 'reply' },
        ],
      },
    },
    {
      name: 'репост отсутствующего поста',
      seed: {
        users: [{ id: ALICE, username: 'alice' }],
        posts: [{ id: 'repost', authorId: ALICE, originalPostId: 'missing' }],
      },
    },
    {
      name: 'цикл репостов',
      seed: {
        users: [{ id: ALICE, username: 'alice' }],
        posts: [
          { id: 'a', authorId: ALICE, originalPostId: 'b' },
          { id: 'b', authorId: ALICE, originalPostId: 'a' },
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

  it('хранит пост seed на своей стене без адресата', () => {
    const server = createMockServer({
      seed: {
        users: [{ id: ALICE, username: 'alice' }],
        posts: [{ id: 'own', authorId: ALICE, wallRecipientId: ALICE }],
      },
    });

    expect(server.snapshot().posts[0]?.wallRecipientId).toBeNull();
  });

  it('сообщает о неподдерживаемом запросе ошибкой пакета', async () => {
    const server = makeServer();
    const client = new ItdClient(server.clientOptions({ as: 'alice' }));
    await client.request({ method: HttpMethod.Get, path: '/api/not-implemented' }).catch(() => {});

    expect(() => server.assertNoUnsupportedRequests()).toThrow(ItdTestingError);
  });
});
