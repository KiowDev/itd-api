import { describe, expect, it } from 'vitest';
import { ItdClient } from '../../src/client.js';
import { MemoryKeyValueStore } from '../../src/core/key-value-store.js';
import type { ShopOrderAccessSession } from '../../src/models/shop.js';
import { createShopFeature } from '../../src/shop/feature.js';
import {
  createShopOrderAccessStorage,
  MemoryShopOrderAccessStorage,
} from '../../src/shop/order-access.js';
import { createMockFetch, json, noContent, type RecordedRequest } from '../helpers/mock-fetch.js';

function makeClient(responses: Response[]) {
  const mock = createMockFetch(responses);
  const itd = new ItdClient({
    baseUrl: 'https://itd.test',
    fetch: mock.fetch,
    auth: 'itd-token',
    retry: false,
    rateLimit: false,
    mode: 'server',
  });
  return { itd, mock };
}

const item = { productId: 'shirt', size: null, color: 'black', qty: 1 };
const product = {
  id: 'shirt',
  title: 'Футболка',
  category: 'apparel',
  price: 3_999,
  images: ['https://cdn.example.test/product.webp'],
  sizes: ['Один размер'],
  colors: [
    {
      id: 'black',
      label: 'Чёрный',
      hex: '#141414',
      images: ['https://cdn.example.test/product-black.webp'],
    },
  ],
  description: '',
  specs: [{ label: 'Состав ткани', value: 'Хлопок' }],
  sizeChart: {
    note: 'Тестовые размеры',
    rows: [{ size: 'Один размер', values: ['70 см'] }],
    columns: ['Длина'],
  },
  status: 'available',
  stockLeft: null,
};
const deliveryPoint = {
  code: 'MSK1',
  name: 'Пункт выдачи',
  city: 'Москва',
  cityCode: 44,
  countryCode: 'RU',
  postalCode: '101000',
  address: 'Тестовая улица, 1',
  latitude: 55.75,
  longitude: 37.62,
  workTime: 'Ежедневно',
  metro: '',
  note: '',
  dressingRoom: true,
  card: true,
  cash: false,
};
const orderInput = {
  items: [item],
  recipient: {
    name: 'Иван Иванов',
    phone: '+79990000000',
    email: 'shop@example.test',
    country: 'RU',
    city: 'Москва',
    address: 'Пункт выдачи',
    cityCode: 44,
    deliveryPoint: 'MSK1',
    comment: '',
  },
  consents: [
    {
      kind: 'offer' as const,
      accepted: true,
      docSlug: 'offer',
      docVersion: '1',
    },
  ],
  consentContext: { form: 'checkout', page: '/shop/checkout', visitorId: 'visitor' },
};

describe('itd.shop', () => {
  it('работает с прямыми ответами каталога и доставки', async () => {
    const { itd, mock } = makeClient([
      json([product]),
      json(product),
      json([{ code: 'RU', name: 'Россия' }]),
      json([{ code: 44, name: 'Москва, Россия', countryCode: 'RU' }]),
      json([deliveryPoint]),
      json({
        costKopecks: 50_000,
        cost: 500,
        periodMin: 2,
        periodMax: 4,
        tariffCode: 136,
        tariffName: 'Посылка склад-склад',
        weightGrams: 500,
      }),
    ]);

    await expect(itd.shop.products.list()).resolves.toEqual([product]);
    await expect(itd.shop.products.get('shirt')).resolves.toEqual(product);
    await itd.shop.delivery.countries();
    await itd.shop.delivery.cities('Москва', 'RU');
    await expect(itd.shop.delivery.points(44)).resolves.toEqual([deliveryPoint]);
    await expect(
      itd.shop.delivery.calculate([item], { code: 44, countryCode: 'RU' }),
    ).resolves.toEqual({
      costKopecks: 50_000,
      cost: 500,
      periodMin: 2,
      periodMax: 4,
      tariffCode: 136,
      tariffName: 'Посылка склад-склад',
      weightGrams: 500,
    });

    expect(mock.calls.map((call) => [call.method, call.url])).toEqual([
      ['GET', 'https://itd.test/api/v1/shop/products'],
      ['GET', 'https://itd.test/api/v1/shop/products/shirt'],
      ['GET', 'https://itd.test/api/v1/shop/delivery/countries'],
      [
        'GET',
        'https://itd.test/api/v1/shop/delivery/cities?q=%D0%9C%D0%BE%D1%81%D0%BA%D0%B2%D0%B0&country=RU',
      ],
      ['GET', 'https://itd.test/api/v1/shop/delivery/points?cityCode=44'],
      ['POST', 'https://itd.test/api/v1/shop/delivery/calculate'],
    ]);
  });

  it('возвращает null для отсутствующего товара', async () => {
    const { itd } = makeClient([
      json({ error: { code: 'NOT_FOUND', message: 'Товар не найден' } }, { status: 404 }),
    ]);

    await expect(itd.shop.products.get('missing')).resolves.toBeNull();
  });

  it('использует Bearer ИТД по умолчанию и позволяет передать токен заказов', async () => {
    const { itd, mock } = makeClient([
      json({ items: [] }),
      json({ number: 'A-1' }),
      json({ url: 'https://pay.test' }),
    ]);

    await itd.shop.orders.list();
    await itd.shop.orders.get('A-1', { orderAccessToken: 'order-token' });
    await itd.shop.orders.pay('A-1', {
      orderAccessToken: 'order-token',
      returnUrl: 'https://app.test/orders/A-1',
    });

    for (const call of mock.calls) {
      expect(call.headers.get('authorization')).toBe('Bearer itd-token');
    }
    expect(mock.calls[0]?.headers.get('x-order-token')).toBeNull();
    expect(mock.calls[1]?.headers.get('x-order-token')).toBe('order-token');
    expect(mock.calls[2]?.headers.get('x-order-token')).toBe('order-token');
  });

  it('useItdAuth: false отправляет только X-Order-Token', async () => {
    const { itd, mock } = makeClient([json({ items: [] })]);

    await itd.shop.orders.list({ orderAccessToken: 'guest', useItdAuth: false });

    expect(mock.calls[0]?.headers.get('authorization')).toBeNull();
    expect(mock.calls[0]?.headers.get('x-order-token')).toBe('guest');
  });

  it('создаёт Idempotency-Key один раз на вызов', async () => {
    const { itd, mock } = makeClient([json({ number: 'A-1', pass: 'guest' })]);

    await itd.shop.orders.create(orderInput, { idempotencyKey: 'order-key' });

    expect(mock.calls[0]?.headers.get('idempotency-key')).toBe('order-key');
    expect(JSON.parse(mock.calls[0]?.body ?? '{}')).toEqual(orderInput);
  });

  it('запрашивает и проверяет код анонимно', async () => {
    const { itd, mock } = makeClient([noContent(), json({ token: 'guest', expiresInSec: 600 })]);

    await itd.shop.orders.requestAccessCode('shop@example.test');
    await itd.shop.orders.verifyAccessCode('shop@example.test', '123456');

    expect(mock.calls.every((call) => !call.headers.has('authorization'))).toBe(true);
    expect(mock.calls.map((call) => call.url)).toEqual([
      'https://itd.test/api/v1/shop/orders/lookup/request',
      'https://itd.test/api/v1/shop/orders/lookup/verify',
    ]);
  });
});

describe('createShopFeature()', () => {
  it('изолирует хранилище одной feature между клиентами', async () => {
    const feature = createShopFeature();
    const first = makeClient([noContent(), json({ token: 'first-token', expiresInSec: 600 })]);
    const second = makeClient([]);
    const firstAccess = first.itd.install(feature);
    const secondAccess = second.itd.install(feature);

    await firstAccess.requestCode('first@example.test');
    await firstAccess.verifyCode('123456');

    await expect(firstAccess.session()).resolves.toMatchObject({ token: 'first-token' });
    await expect(secondAccess.session()).resolves.toBeNull();
    await expect(secondAccess.list()).rejects.toThrow(/доступ к заказам отсутствует/);
    expect(second.mock.callCount).toBe(0);
  });

  it('использует общий KeyValueStore', async () => {
    const backend = new MemoryKeyValueStore<ShopOrderAccessSession>();
    const storage = createShopOrderAccessStorage(backend, { key: 'orders' });
    const session = {
      email: 'shop@example.test',
      token: 'guest-token',
      expiresAt: 10_000,
    };

    await storage.set(session);
    expect(await backend.get('orders')).toEqual(session);
    expect(await storage.get()).toEqual(session);
    await storage.clear();
    expect(await backend.get('orders')).toBeUndefined();
  });

  it('хранит отдельную сессию и не отправляет Bearer ИТД', async () => {
    const { itd, mock } = makeClient([
      noContent(),
      json({ token: 'guest-token', expiresInSec: 600 }),
      json({ items: [] }),
      json({ number: 'A-1' }),
      json({ url: 'https://pay.test' }),
    ]);
    const storage = new MemoryShopOrderAccessStorage();
    const access = itd.install(createShopFeature({ storage }));

    await access.requestCode('shop@example.test');
    const session = await access.verifyCode('123456');
    await access.list();
    await access.get('A-1');
    await access.pay('A-1', 'https://app.test/order/A-1');

    expect(session).toMatchObject({ email: 'shop@example.test', token: 'guest-token' });
    expect(await storage.get()).toEqual(session);
    expect(mock.calls.every((call) => !call.headers.has('authorization'))).toBe(true);
    expect(mock.calls.slice(2).map(orderToken)).toEqual([
      'guest-token',
      'guest-token',
      'guest-token',
    ]);
  });

  it('удаляет истёкшую сессию до запроса', async () => {
    const storage = new MemoryShopOrderAccessStorage({
      email: 'shop@example.test',
      token: 'expired',
      expiresAt: 1,
    });
    const { itd, mock } = makeClient([]);
    const access = itd.install(createShopFeature({ storage }));

    await expect(access.list()).rejects.toThrow(/истёк/);
    expect(await storage.get()).toBeNull();
    expect(mock.callCount).toBe(0);
  });

  it('удаляет сессию после ответа 401', async () => {
    const storage = new MemoryShopOrderAccessStorage({
      email: 'shop@example.test',
      token: 'rejected',
      expiresAt: Date.now() + 60_000,
    });
    const { itd } = makeClient([
      json({ error: { code: 'UNAUTHORIZED', message: 'Нет доступа' } }, { status: 401 }),
    ]);
    const access = itd.install(createShopFeature({ storage }));

    await expect(access.list()).rejects.toMatchObject({ status: 401 });
    await expect(access.session()).resolves.toBeNull();
  });
});

function orderToken(request: RecordedRequest): string | null {
  return request.headers.get('x-order-token');
}
