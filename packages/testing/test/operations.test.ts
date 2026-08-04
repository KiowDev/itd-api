import { ItdClient } from 'itd-api';
import { describe, expect, it } from 'vitest';
import {
  createMockOperations,
  UnhandledOperationError,
  UnusedMockOperationsError,
  userFixture,
} from '../src/index.js';

describe('createMockOperations', () => {
  it('подменяет логическую операцию без вызова транспорта', async () => {
    let fetchCalls = 0;
    const mock = createMockOperations().operation('users.me', userFixture());
    const client = new ItdClient({
      auth: 'token',
      fetch: async () => {
        fetchCalls += 1;
        throw new Error('fetch не должен вызываться');
      },
    }).use(mock);

    await expect(client.users.me()).resolves.toEqual(userFixture());
    expect(fetchCalls).toBe(0);
    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0]).toMatchObject({ operationId: 'users.me', sequence: 1 });
    mock.assertDone();
  });

  it('выдаёт последовательность готовых результатов и повторяет последний', async () => {
    const mock = createMockOperations().sequence(
      'users.me',
      [userFixture({ id: 'first' }), userFixture({ id: 'second' })],
      { repeat: true },
    );
    const client = new ItdClient({ auth: 'token' }).use(mock);

    await expect(client.users.me()).resolves.toMatchObject({ id: 'first' });
    await expect(client.users.me()).resolves.toMatchObject({ id: 'second' });
    await expect(client.users.me()).resolves.toMatchObject({ id: 'second' });
    mock.assertDone();
  });

  it('передаёт обработчику operationId, параметры и тело', async () => {
    const mock = createMockOperations().operation('posts.get', (request) => ({
      id: request.path.split('/').at(-1),
      operationId: request.operationId,
    }));
    const client = new ItdClient({ auth: 'token' }).use(mock);

    await expect(client.posts.get('post-1')).resolves.toMatchObject({
      id: 'post-1',
      operationId: 'posts.get',
    });
  });

  it('по умолчанию отклоняет неизвестную операцию и проверяет неиспользованные ответы', async () => {
    const mock = createMockOperations().operation('users.me', userFixture());
    const client = new ItdClient({ auth: 'token' }).use(mock);

    await expect(client.posts.get('post-1')).rejects.toBeInstanceOf(UnhandledOperationError);
    expect(() => mock.assertDone()).toThrow(UnhandledOperationError);

    mock.clearCalls();
    expect(() => mock.assertDone()).toThrow(UnusedMockOperationsError);
  });

  it('может пропускать незарегистрированные операции в настоящий pipeline', async () => {
    const mock = createMockOperations({ passthrough: true });
    const client = new ItdClient({
      auth: 'token',
      fetch: async () =>
        new Response(JSON.stringify({ data: { id: 'from-fetch' } }), {
          headers: { 'content-type': 'application/json' },
        }),
    }).use(mock);

    await expect(client.users.me()).resolves.toMatchObject({ id: 'from-fetch' });
    expect(mock.calls).toHaveLength(1);
    mock.assertDone();
  });
});
