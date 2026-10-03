import type { CreateShopOrderInput } from 'itd-api';
import { HttpMethod } from '../../http/http.constants.js';
import type { MockRequest } from '../../http/request.types.js';
import { emptyResponse, jsonResponse } from '../../http/responses.utils.js';
import { objectBody } from '../shared/request.utils.js';
import type { MockRouteContext } from '../shared/route.types.js';
import { orderSummary } from './shop.presenter.js';
import type { ShopCredentials } from './shop.types.js';

const DELIVERY_COUNTRIES = [{ code: 'RU', name: 'Россия' }];

const DELIVERY_ESTIMATE = {
  costKopecks: 50_000,
  cost: 500,
  periodMin: 2,
  periodMax: 5,
  tariffCode: 136,
  tariffName: 'Посылка склад-склад',
  weightGrams: 500,
};

function deliveryPoint(cityCode: number) {
  return {
    code: 'PVZ-1',
    name: 'Пункт выдачи',
    city: 'Москва',
    cityCode,
    countryCode: 'RU',
    postalCode: '101000',
    address: 'Тестовая улица, 1',
    latitude: 55.75,
    longitude: 37.62,
    dressingRoom: true,
    card: true,
    cash: false,
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
    return jsonResponse(
      query ? [{ code: 44, name: query, countryCode: request.query.get('country') ?? 'RU' }] : [],
    );
  });
  route(HttpMethod.Get, '/api/v1/shop/delivery/points', (request) =>
    jsonResponse([deliveryPoint(Number(request.query.get('cityCode')))]),
  );
  route(HttpMethod.Post, '/api/v1/shop/delivery/calculate', () => jsonResponse(DELIVERY_ESTIMATE));

  route(HttpMethod.Post, '/api/v1/shop/orders', (request) =>
    jsonResponse(
      shop.createOrder(objectBody(request) as unknown as CreateShopOrderInput, {
        userId: auth.authenticate(request)?.profile.id,
        idempotencyKey: request.headers.get('idempotency-key'),
      }),
    ),
  );

  route(HttpMethod.Get, '/api/v1/shop/orders/my', (request) =>
    jsonResponse({
      items: shop.ordersFor(credentials(request)).map((order) => orderSummary(order.value)),
    }),
  );

  route(HttpMethod.Post, '/api/v1/shop/orders/lookup/request', () => jsonResponse({ sent: true }));
  route(HttpMethod.Post, '/api/v1/shop/orders/lookup/verify', (request) => {
    const { email, code } = objectBody(request);
    return jsonResponse(shop.grantAccess(email, code));
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
