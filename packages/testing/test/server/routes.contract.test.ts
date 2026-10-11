import { describe, expect, it } from 'vitest';
import { createMockServer, HttpMethod } from '../../src/index.js';
import { ALICE, BOB } from './test-server.utils.js';

const ORDER = {
  items: [{ productId: 'hoodie', size: 'M', color: null, qty: 1 }],
  recipient: {
    name: 'Покупатель',
    phone: '+70000000000',
    email: 'buyer@example.test',
    country: 'Россия',
    city: 'Москва',
    address: 'Тестовая улица, 1',
    cityCode: 44,
    deliveryPoint: '',
    comment: '',
  },
  consents: [],
  consentContext: { form: 'checkout', page: '/shop', visitorId: 'visitor' },
};

/** Каждый встроенный маршрут mock-server с допустимыми параметрами. */
const SUPPORTED: ReadonlyArray<readonly [string, string, unknown?]> = [
  [HttpMethod.Get, '/api/profile'],
  [HttpMethod.Get, '/api/users/me'],
  [HttpMethod.Put, '/api/users/me', { displayName: 'Алиса' }],
  [HttpMethod.Get, '/api/users/check-username?username=free_name'],
  [HttpMethod.Get, '/api/users/bob'],
  [HttpMethod.Get, '/api/users/bob/followers'],
  [HttpMethod.Get, '/api/users/bob/following'],
  [HttpMethod.Get, '/api/users/stats/top-clans'],
  [HttpMethod.Post, '/api/users/bob/follow'],
  [HttpMethod.Delete, '/api/users/bob/follow'],
  [HttpMethod.Get, '/api/posts'],
  [HttpMethod.Get, '/api/posts?tab=following'],
  [HttpMethod.Get, '/api/posts/user/bob'],
  [HttpMethod.Get, '/api/posts/user/bob/liked'],
  [HttpMethod.Post, '/api/posts', { content: 'Пост' }],
  [HttpMethod.Get, '/api/posts/post-1'],
  [HttpMethod.Put, '/api/posts/own-post', { content: 'Изменён' }],
  [HttpMethod.Post, '/api/posts/post-1/like'],
  [HttpMethod.Delete, '/api/posts/post-1/like'],
  [HttpMethod.Post, '/api/posts/post-1/repost', { content: '' }],
  [HttpMethod.Delete, '/api/posts/post-1/repost'],
  [HttpMethod.Delete, '/api/posts/own-post'],
  [HttpMethod.Post, '/api/posts/own-post/restore'],
  [HttpMethod.Get, '/api/posts/post-1/comments'],
  [HttpMethod.Post, '/api/posts/post-1/comments', { content: 'Комментарий' }],
  [HttpMethod.Get, '/api/comments/comment-1/replies'],
  [HttpMethod.Post, '/api/comments/comment-1/replies', { content: 'Ответ' }],
  [HttpMethod.Patch, '/api/comments/own-comment', { content: 'Изменён' }],
  [HttpMethod.Post, '/api/comments/comment-1/like'],
  [HttpMethod.Delete, '/api/comments/comment-1/like'],
  [HttpMethod.Delete, '/api/comments/own-comment'],
  [HttpMethod.Post, '/api/comments/own-comment/restore'],
  [HttpMethod.Get, '/api/hashtags/trending'],
  [HttpMethod.Get, '/api/hashtags/итд/posts'],
  [HttpMethod.Get, '/api/search?q=bob'],
  [HttpMethod.Get, '/api/notifications/'],
  [HttpMethod.Get, '/api/notifications/count'],
  [HttpMethod.Post, '/api/notifications/notification-1/read'],
  [HttpMethod.Post, '/api/notifications/read-batch', { ids: ['notification-1'] }],
  [HttpMethod.Post, '/api/notifications/read-all'],
  [HttpMethod.Get, '/api/v1/shop/products'],
  [HttpMethod.Get, '/api/v1/shop/products/hoodie'],
  [HttpMethod.Get, '/api/v1/shop/delivery/countries'],
  [HttpMethod.Get, '/api/v1/shop/delivery/cities?q=Москва'],
  [HttpMethod.Get, '/api/v1/shop/delivery/points?cityCode=44'],
  [HttpMethod.Post, '/api/v1/shop/delivery/calculate', {}],
  [HttpMethod.Post, '/api/v1/shop/orders', ORDER],
  [HttpMethod.Get, '/api/v1/shop/orders/my'],
  [HttpMethod.Post, '/api/v1/shop/orders/lookup/request', { email: 'buyer@example.test' }],
  [HttpMethod.Post, '/api/v1/shop/orders/lookup/verify', { email: 'a@b.test', code: '123456' }],
  [HttpMethod.Get, '/api/v1/shop/orders/SHOP-000001'],
  [HttpMethod.Post, '/api/v1/shop/orders/SHOP-000001/pay'],
  [HttpMethod.Post, '/api/v1/shop/consents', {}],
  [HttpMethod.Delete, '/api/users/me'],
  [HttpMethod.Post, '/api/users/me/restore'],
];

/** Существующие в API ресурсы, которые mock-server намеренно не моделирует. */
const UNSUPPORTED: ReadonlyArray<readonly [string, string]> = [
  [HttpMethod.Post, '/api/posts/post-1/pin'],
  [HttpMethod.Post, '/api/users/bob/block'],
  [HttpMethod.Get, '/api/users/me/privacy'],
  [HttpMethod.Get, '/api/notifications/settings'],
];

function makeContractServer() {
  const server = createMockServer({
    seed: {
      users: [
        { id: ALICE, username: 'alice' },
        { id: BOB, username: 'bob' },
      ],
      posts: [
        { id: 'post-1', authorId: BOB },
        { id: 'own-post', authorId: ALICE },
      ],
      comments: [
        { id: 'comment-1', postId: 'post-1', authorId: BOB },
        { id: 'own-comment', postId: 'post-1', authorId: ALICE },
      ],
      notifications: [{ id: 'notification-1', userId: ALICE, actorIds: [BOB] }],
    },
  });
  const options = server.clientOptions({ as: 'alice' });
  const send = (method: string, path: string, body?: unknown) =>
    server.fetch(`${options.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${String(options.auth)}`,
        'content-type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return { server, send };
}

describe('createMockServer: контракт маршрутов', () => {
  it('обслуживает каждый встроенный маршрут без 501', async () => {
    const { server, send } = makeContractServer();

    for (const [method, path, body] of SUPPORTED) {
      const response = await send(method, path, body);
      expect.soft(response.status, `${method} ${path}`).not.toBe(501);
    }
    expect(server.unsupportedRequests).toEqual([]);
  });

  it.each(UNSUPPORTED)('явно не поддерживает %s %s', async (method, path) => {
    const { server, send } = makeContractServer();

    const response = await send(method, path);

    expect(response.status).toBe(501);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'MOCK_ROUTE_NOT_IMPLEMENTED' },
    });
    expect(() => server.assertNoUnsupportedRequests()).toThrow(path);
  });
});
