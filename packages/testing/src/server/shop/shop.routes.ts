import type { ShopOrderItemInput } from 'itd-api';
import { HttpMethod } from '../../http/http.constants.js';
import type { MockRequest } from '../../http/request.types.js';
import { emptyResponse, jsonResponse } from '../../http/responses.utils.js';
import { MockDomainError } from '../shared/domain.errors.js';
import { isRecord, objectBody, stringField } from '../shared/request.utils.js';
import type { MockRouteContext } from '../shared/route.types.js';
import { DELIVERY_COUNTRIES, DELIVERY_ESTIMATE } from './shop.constants.js';
import { deliveryCity, deliveryPoint, orderList } from './shop.presenter.js';
import type { NewShopOrder, ShopCredentials } from './shop.types.js';

/** Строковое поле, без которого запрос не имеет смысла. */
function requiredString(body: Record<string, unknown>, key: string, label = key): string {
  const value = stringField(body, key);
  if (value === undefined) throw MockDomainError.validation(`${label}: ожидается строка`);
  return value;
}

function orderItem(value: unknown): ShopOrderItemInput {
  if (!isRecord(value) || !Number.isInteger(value.qty) || (value.qty as number) <= 0) {
    throw MockDomainError.validation('items: ожидается товар и положительное количество');
  }
  return {
    productId: requiredString(value, 'productId', 'items.productId'),
    size: stringField(value, 'size') ?? null,
    color: stringField(value, 'color') ?? null,
    qty: value.qty as number,
  };
}

/** Заказ из тела запроса: непустой список позиций и получатель с адресом. */
function newOrder(body: Record<string, unknown>): NewShopOrder {
  const { items, recipient } = body;
  if (!Array.isArray(items) || items.length === 0) {
    throw MockDomainError.validation('items: ожидается непустой список позиций заказа');
  }
  if (!isRecord(recipient)) throw MockDomainError.validation('recipient: ожидается получатель');
  return {
    items: items.map(orderItem),
    recipient: {
      email: requiredString(recipient, 'email', 'recipient.email'),
      city: requiredString(recipient, 'city', 'recipient.city'),
      address: requiredString(recipient, 'address', 'recipient.address'),
      deliveryPoint: stringField(recipient, 'deliveryPoint') || null,
      comment: stringField(recipient, 'comment') || null,
    },
  };
}

export function registerShopRoutes({ services, auth, route }: MockRouteContext): void {
  const { shop } = services;

  const credentials = (request: MockRequest): ShopCredentials => ({
    userId: auth.authenticate(request)?.profile.id,
    token: request.headers.get('x-order-token'),
  });

  route(HttpMethod.Get, '/api/v1/shop/products', () => jsonResponse(shop.products()));
  route(HttpMethod.Get, '/api/v1/shop/products/:productId', (request) =>
    jsonResponse(shop.requireProduct(request.params.productId ?? '')),
  );
  route(HttpMethod.Get, '/api/v1/shop/delivery/countries', () => jsonResponse(DELIVERY_COUNTRIES));
  route(HttpMethod.Get, '/api/v1/shop/delivery/cities', (request) => {
    const query = request.query.get('q')?.trim() ?? '';
    const country = request.query.get('country') ?? 'RU';
    return jsonResponse(query ? [deliveryCity(query, country)] : []);
  });
  route(HttpMethod.Get, '/api/v1/shop/delivery/points', (request) =>
    jsonResponse([deliveryPoint(Number(request.query.get('cityCode')))]),
  );
  route(HttpMethod.Post, '/api/v1/shop/delivery/calculate', () => jsonResponse(DELIVERY_ESTIMATE));

  route(HttpMethod.Post, '/api/v1/shop/orders', (request) =>
    jsonResponse(
      shop.createOrder(newOrder(objectBody(request)), {
        userId: auth.authenticate(request)?.profile.id,
        idempotencyKey: request.headers.get('idempotency-key'),
      }),
    ),
  );

  route(HttpMethod.Get, '/api/v1/shop/orders/my', (request) =>
    jsonResponse(orderList(shop.ordersFor(credentials(request)))),
  );

  route(HttpMethod.Post, '/api/v1/shop/orders/lookup/request', () => jsonResponse({ sent: true }));
  route(HttpMethod.Post, '/api/v1/shop/orders/lookup/verify', (request) => {
    const body = objectBody(request);
    return jsonResponse(
      shop.grantAccess(requiredString(body, 'email'), stringField(body, 'code') ?? ''),
    );
  });

  route(HttpMethod.Get, '/api/v1/shop/orders/:orderNumber', (request) => {
    const order = shop.findOrder(request.params.orderNumber ?? '');
    if (!order) return jsonResponse(null);
    shop.assertAccess(order, credentials(request));
    return jsonResponse(order.value);
  });
  route(HttpMethod.Post, '/api/v1/shop/orders/:orderNumber/pay', (request) => {
    const order = shop.requireAccessibleOrder(
      request.params.orderNumber ?? '',
      credentials(request),
    );
    return jsonResponse({ url: shop.paymentUrl(order) });
  });
  route(HttpMethod.Post, '/api/v1/shop/consents', () => emptyResponse());
}
