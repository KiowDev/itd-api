import { expect, it } from 'vitest';
import { ItdClient, MessageAccess } from '../../src/index.js';
import { createMockFetch, json } from '../helpers/mock-fetch.js';

it('перебирает список исключений и меняет его по идентификатору пользователя', async () => {
  const first = { id: 'u1', displayName: 'Алиса', addedAt: '2026-11-23T10:00:00Z' };
  const second = { id: 'u2', displayName: 'Борис', avatar: null };
  const mock = createMockFetch([
    json({ data: { users: [first], pagination: { page: 2, limit: 1, total: 3, hasMore: true } } }),
    json({
      data: { users: [second], pagination: { page: 3, limit: 1, total: 3, hasMore: false } },
    }),
    json({ inMessageAllowlist: true }),
    json({ inMessageAllowlist: false }),
    json({ messageAccess: 'following' }),
  ]);
  const itd = new ItdClient({ baseUrl: 'https://itd.test', auth: 'test-token', fetch: mock.fetch });

  try {
    const iterator = itd.users.iterateMessageAllowlist({ page: 2, limit: 1 });
    expect(await iterator.collect()).toEqual([first, second]);
    expect(await itd.users.addToMessageAllowlist('u/3')).toEqual({ inMessageAllowlist: true });
    expect(await itd.users.removeFromMessageAllowlist('u/3')).toEqual({
      inMessageAllowlist: false,
    });
    await itd.users.updatePrivacy({ messageAccess: MessageAccess.Following });

    expect(mock.calls.map(({ url, method }) => [method, new URL(url).pathname])).toEqual([
      ['GET', '/api/users/me/message-allowlist'],
      ['GET', '/api/users/me/message-allowlist'],
      ['POST', '/api/users/u%2F3/message-allowlist'],
      ['DELETE', '/api/users/u%2F3/message-allowlist'],
      ['PUT', '/api/users/me/privacy'],
    ]);
    expect(
      mock.calls.slice(0, 2).map(({ url }) => Object.fromEntries(new URL(url).searchParams)),
    ).toEqual([
      { page: '2', limit: '1' },
      { page: '3', limit: '1' },
    ]);
    expect(mock.calls.slice(2, 4).map(({ body }) => body)).toEqual([undefined, undefined]);
    expect(mock.calls[4]?.body).toBe('{"messageAccess":"following"}');
  } finally {
    await itd.close();
  }
});
