import { createShopFeature, ItdClient } from 'itd-api';
import { describe, expect, it } from 'vitest';
import { createMockServer, createTestClock } from '../../src/index.js';

describe('createMockServer: магазин', () => {
  it('выполняет сценарий магазина с доступом по коду из письма', async () => {
    const server = createMockServer({
      clock: createTestClock('2026-08-01T10:00:00Z'),
      seed: {
        shopProducts: [
          {
            id: 'hoodie',
            title: 'Худи',
            category: 'apparel',
            price: 4_000,
            images: [],
            sizes: ['M'],
            colors: [],
            description: '',
            specs: [],
            status: 'available',
            stockLeft: 10,
          },
        ],
      },
    });
    const client = new ItdClient(server.clientOptions({ as: 'test-user-1' }));
    const created = await client.shop.orders.create({
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
    });
    expect(await client.shop.orders.get(created.number)).toMatchObject({ total: 4_500 });

    const anonymous = new ItdClient({
      baseUrl: 'https://mock.itd.test',
      fetch: server.fetch,
      retry: false,
      rateLimit: false,
      userAgent: false,
    });
    const access = anonymous.install(createShopFeature());
    await access.requestCode('buyer@example.test');
    await access.verifyCode('123456');
    await expect(access.list()).resolves.toMatchObject({
      items: [{ number: created.number }],
    });
    server.assertNoUnsupportedRequests();
  });

  it('отклоняет неизвестный и истёкший токены заказов', async () => {
    const clock = createTestClock('2026-08-01T10:00:00Z');
    const server = createMockServer({ clock });
    const client = new ItdClient({
      baseUrl: 'https://mock.itd.test',
      fetch: server.fetch,
      retry: false,
      rateLimit: false,
      userAgent: false,
    });

    await expect(
      client.shop.orders.list({ orderAccessToken: 'unknown', useItdAuth: false }),
    ).rejects.toMatchObject({ status: 401 });

    const email = 'buyer@example.test';
    await client.shop.orders.requestAccessCode(email);
    const { token } = await client.shop.orders.verifyAccessCode(email, '123456');
    await clock.advanceBy(600_001);

    await expect(
      client.shop.orders.list({ orderAccessToken: token, useItdAuth: false }),
    ).rejects.toMatchObject({ status: 401 });
    server.assertNoUnsupportedRequests();
  });
});
