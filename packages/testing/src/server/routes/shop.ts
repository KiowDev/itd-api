import type { CreateShopOrderInput, ShopOrder, ShopOrderItem, ShopOrderSummary } from 'itd-api';
import { HttpMethod } from '../../constants.js';
import type { MockRequest } from '../../request.js';
import { apiErrorResponse, emptyResponse, jsonResponse } from '../../responses.js';
import type { ShopOrderState } from '../entities.js';
import { type MockRouteContext, objectBody } from './context.js';

function orderSummary(order: ShopOrder): ShopOrderSummary {
  return {
    number: order.number,
    titles: order.items.map((item) => item.title),
    status: order.status,
    total: order.total,
    createdAt: order.createdAt,
  };
}

function emailAccess(request: MockRequest, state: MockRouteContext['state']): string | undefined {
  const token = request.headers.get('x-order-token');
  if (!token) return undefined;
  const access = state.shopAccess.get(token);
  if (!access) return undefined;
  if (access.expiresAt > state.clock.now()) return access.email;
  state.shopAccess.delete(token);
  return undefined;
}

function canOpen(
  request: MockRequest,
  order: ShopOrderState,
  state: MockRouteContext['state'],
): boolean {
  const user = state.authUser(request);
  if (user && order.userId === user.profile.id) return true;
  const token = request.headers.get('x-order-token');
  return token === order.accessToken || emailAccess(request, state) === order.email;
}

function orderItems(
  input: CreateShopOrderInput,
  state: MockRouteContext['state'],
): ShopOrderItem[] {
  return input.items.map((item) => {
    const product = state.shopProducts.get(item.productId);
    return {
      slug: item.productId,
      title: product?.title ?? item.productId,
      color: item.color,
      size: item.size,
      qty: item.qty,
      sum: (product?.price ?? 0) * item.qty,
    };
  });
}

export function registerShopRoutes(context: MockRouteContext): void {
  const { state, route } = context;

  route(HttpMethod.Get, '/api/v1/shop/products', () =>
    jsonResponse([...state.shopProducts.values()]),
  );
  route(HttpMethod.Get, '/api/v1/shop/products/:productId', (request) =>
    state.shopProducts.has(request.params.productId ?? '')
      ? jsonResponse(state.shopProducts.get(request.params.productId ?? ''))
      : apiErrorResponse(404, 'NOT_FOUND', 'Товар не найден'),
  );
  route(HttpMethod.Get, '/api/v1/shop/delivery/countries', () =>
    jsonResponse([{ code: 'RU', name: 'Россия' }]),
  );
  route(HttpMethod.Get, '/api/v1/shop/delivery/cities', (request) => {
    const query = request.query.get('q')?.trim() ?? '';
    return jsonResponse(
      query ? [{ code: 44, name: query, countryCode: request.query.get('country') ?? 'RU' }] : [],
    );
  });
  route(HttpMethod.Get, '/api/v1/shop/delivery/points', (request) =>
    jsonResponse([
      {
        code: 'PVZ-1',
        name: 'Пункт выдачи',
        city: 'Москва',
        cityCode: Number(request.query.get('cityCode')),
        countryCode: 'RU',
        postalCode: '101000',
        address: 'Тестовая улица, 1',
        latitude: 55.75,
        longitude: 37.62,
        dressingRoom: true,
        card: true,
        cash: false,
      },
    ]),
  );
  route(HttpMethod.Post, '/api/v1/shop/delivery/calculate', () =>
    jsonResponse({
      costKopecks: 50_000,
      cost: 500,
      periodMin: 2,
      periodMax: 5,
      tariffCode: 136,
      tariffName: 'Посылка склад-склад',
      weightGrams: 500,
    }),
  );

  route(HttpMethod.Post, '/api/v1/shop/orders', (request) => {
    const idempotencyKey = request.headers.get('idempotency-key');
    const previous = idempotencyKey ? state.shopIdempotency.get(idempotencyKey) : undefined;
    if (previous) return jsonResponse(previous);

    const input = objectBody(request) as unknown as CreateShopOrderInput;
    const items = orderItems(input, state);
    const itemsTotal = items.reduce((sum, item) => sum + item.sum, 0);
    const number = state.nextShopOrderNumber();
    const userId = state.authUser(request)?.profile.id;
    const pass = userId ? undefined : `order-pass-${number}`;
    const value: ShopOrder = {
      number,
      status: 'new',
      createdAt: state.now(),
      payment: { pending: false },
      items,
      itemsTotal,
      shipping: 500,
      total: itemsTotal + 500,
      delivery: {
        city: input.recipient.city,
        address: input.recipient.address,
        point: input.recipient.deliveryPoint || null,
      },
      comment: input.recipient.comment || null,
      track: null,
      support: { email: 'shop@example.test' },
    };
    state.shopOrders.set(number, {
      value,
      email: input.recipient.email.trim().toLowerCase(),
      ...(userId ? { userId } : {}),
      ...(pass ? { accessToken: pass } : {}),
    });
    const result = { number, ...(pass ? { pass } : {}) };
    if (idempotencyKey) state.shopIdempotency.set(idempotencyKey, result);
    return jsonResponse(result);
  });

  route(HttpMethod.Get, '/api/v1/shop/orders/my', (request) => {
    const userId = state.authUser(request)?.profile.id;
    const email = emailAccess(request, state);
    const token = request.headers.get('x-order-token');
    const hasOrderPass =
      token !== null && [...state.shopOrders.values()].some((order) => order.accessToken === token);
    if (!userId && !email && !hasOrderPass) {
      return apiErrorResponse(401, 'UNAUTHORIZED', 'Нужна авторизация');
    }
    const items = [...state.shopOrders.values()]
      .filter(
        (order) =>
          (userId !== undefined && order.userId === userId) ||
          (email !== undefined && order.email === email) ||
          (token !== null && order.accessToken === token),
      )
      .map((order) => orderSummary(order.value));
    return jsonResponse({ items });
  });

  route(HttpMethod.Post, '/api/v1/shop/orders/lookup/request', () => jsonResponse({ sent: true }));
  route(HttpMethod.Post, '/api/v1/shop/orders/lookup/verify', (request) => {
    const { email, code } = objectBody(request);
    if (typeof email !== 'string' || code !== '123456') {
      return apiErrorResponse(400, 'INVALID_CODE', 'Неверный код');
    }
    const normalized = email.trim().toLowerCase();
    const token = `shop-access-${normalized}-${state.clock.now()}`;
    const expiresInSec = 600;
    state.shopAccess.set(token, {
      email: normalized,
      expiresAt: state.clock.now() + expiresInSec * 1_000,
    });
    return jsonResponse({ token, expiresInSec });
  });

  route(HttpMethod.Get, '/api/v1/shop/orders/:orderNumber', (request) => {
    const order = state.shopOrders.get(request.params.orderNumber ?? '');
    if (!order) return jsonResponse(null);
    return canOpen(request, order, state)
      ? jsonResponse(order.value)
      : apiErrorResponse(401, 'UNAUTHORIZED', 'Нет доступа к заказу');
  });
  route(HttpMethod.Post, '/api/v1/shop/orders/:orderNumber/pay', (request) => {
    const order = state.shopOrders.get(request.params.orderNumber ?? '');
    if (!order) return apiErrorResponse(404, 'ORDER_NOT_FOUND', 'Заказ не найден');
    if (!canOpen(request, order, state)) {
      return apiErrorResponse(401, 'UNAUTHORIZED', 'Нет доступа к заказу');
    }
    return jsonResponse({ url: `https://payment.example.test/${order.value.number}` });
  });
  route(HttpMethod.Post, '/api/v1/shop/consents', () => emptyResponse());
}
