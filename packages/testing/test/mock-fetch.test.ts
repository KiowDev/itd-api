import { ItdClient } from 'itd-api';
import { describe, expect, it } from 'vitest';
import {
  apiErrorResponse,
  apiResponse,
  createMockFetch,
  createTestClock,
  HttpMethod,
  hangingResponse,
  userFixture,
} from '../src/index.js';

async function settleUntil(condition: () => boolean): Promise<void> {
  for (let index = 0; index < 100 && !condition(); index += 1) await Promise.resolve();
  if (!condition()) throw new Error('Условие не наступило');
}

describe('createMockFetch', () => {
  it('выдаёт последовательность ответов и управляет повторами клиента', async () => {
    const clock = createTestClock('2026-08-01T10:00:00Z');
    const mock = createMockFetch({ clock });
    mock.get('/api/users/me', [
      apiErrorResponse(503, 'TEMPORARY', 'Попробуйте ещё раз'),
      apiResponse(userFixture()),
    ]);

    const client = new ItdClient({
      baseUrl: 'https://mock.itd.test',
      fetch: mock.fetch,
      auth: 'test-token',
      clock,
      timeout: 0,
      retry: { attempts: 2, baseDelay: 100, maxDelay: 100, jitter: 0 },
      rateLimit: false,
      userAgent: false,
    });

    const pending = client.users.me();
    await settleUntil(() => mock.requests.length === 1);
    expect(mock.requests).toHaveLength(1);
    await settleUntil(() => clock.pending > 0);
    await clock.advanceBy(100);
    await expect(pending).resolves.toMatchObject({ id: userFixture().id });
    mock.assertDone();
  });

  it('передаёт параметры пути и скрывает секреты только в истории', async () => {
    const mock = createMockFetch();
    let actualPassword: unknown;
    mock.post('/api/users/:user', (request) => {
      actualPassword = (request.json as { password: string }).password;
      return apiResponse({ id: request.params.user });
    });

    await mock.fetch('https://mock.itd.test/api/users/alice?token=query-secret', {
      method: HttpMethod.Post,
      headers: { Authorization: 'Bearer secret', 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'body-secret', visible: 'ok' }),
    });

    expect(actualPassword).toBe('body-secret');
    expect(mock.requests[0]).toMatchObject({
      headers: { authorization: '[СКРЫТО]' },
      query: { token: '[СКРЫТО]' },
      body: { password: '[СКРЫТО]', visible: 'ok' },
    });
  });

  it('проверяет обновление токена как обычную последовательность маршрутов', async () => {
    const mock = createMockFetch();
    const authorizations: Array<string | null> = [];
    mock.get('/api/users/me', [
      (request) => {
        authorizations.push(request.headers.get('authorization'));
        return apiErrorResponse(401, 'TOKEN_EXPIRED', 'Токен истёк');
      },
      (request) => {
        authorizations.push(request.headers.get('authorization'));
        return apiResponse(userFixture());
      },
    ]);
    mock.post('/api/v1/auth/refresh', apiResponse({ accessToken: 'fresh-token' }));
    const client = new ItdClient({
      baseUrl: 'https://mock.itd.test',
      fetch: mock.fetch,
      auth: { accessToken: 'old-token', refreshToken: 'refresh-token' },
      retry: false,
      rateLimit: false,
      userAgent: false,
    });

    await expect(client.users.me()).resolves.toMatchObject({ id: userFixture().id });
    expect(authorizations).toEqual(['Bearer old-token', 'Bearer fresh-token']);
    mock.assertDone();
  });

  it('громко сообщает о неизвестном запросе', async () => {
    const mock = createMockFetch();
    await expect(mock.fetch('https://mock.itd.test/unknown')).rejects.toThrow(/Нет обработчика/);
    expect(() => mock.assertNoUnhandledRequests()).toThrow(/Нет обработчика/);
  });

  it('различает обязательные и необязательные маршруты', () => {
    const mock = createMockFetch();
    mock.get('/optional', apiResponse({}), { optional: true });
    expect(() => mock.assertDone()).not.toThrow();
  });

  it('проверяет тайм-аут без глобальной подмены таймеров', async () => {
    const clock = createTestClock('2026-08-01T10:00:00Z');
    const mock = createMockFetch({ clock });
    mock.get('/api/users/me', hangingResponse);
    const client = new ItdClient({
      baseUrl: 'https://mock.itd.test',
      fetch: mock.fetch,
      auth: 'test-token',
      clock,
      timeout: 100,
      retry: false,
      rateLimit: false,
      userAgent: false,
    });

    const pending = client.users.me();
    await settleUntil(() => mock.requests.length === 1);
    await clock.advanceBy(100);
    await expect(pending).rejects.toMatchObject({ name: 'ItdTimeoutError' });
    mock.assertDone();
  });
});
