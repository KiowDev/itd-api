import { isItdApiError } from '../core/errors.js';
import type { RequestOptions } from '../core/options.js';
import { createDeviceId } from '../core/runtime.js';
import { encodePathSegment } from '../core/url.js';
import type {
  CreateShopOrderInput,
  ShopConsent,
  ShopConsentContext,
  ShopCreatedOrder,
  ShopDeliveryCalculation,
  ShopDeliveryCity,
  ShopDeliveryCountry,
  ShopDeliveryDestination,
  ShopDeliveryPoint,
  ShopOrder,
  ShopOrderAccessVerification,
  ShopOrderItemInput,
  ShopOrderSummary,
  ShopPayment,
  ShopProduct,
} from '../models/shop.js';
import { passthroughOperation, voidOperation } from '../operations/common.js';
import { BaseResource } from './base.js';

const PRODUCTS_LIST = passthroughOperation<ShopProduct[]>('shop.products.list');
const PRODUCTS_GET = passthroughOperation<ShopProduct | null>('shop.products.get');
const DELIVERY_COUNTRIES = passthroughOperation<ShopDeliveryCountry[]>('shop.delivery.countries');
const DELIVERY_CITIES = passthroughOperation<ShopDeliveryCity[]>('shop.delivery.cities');
const DELIVERY_POINTS = passthroughOperation<ShopDeliveryPoint[]>('shop.delivery.points');
const DELIVERY_CALCULATE = passthroughOperation<ShopDeliveryCalculation>('shop.delivery.calculate');
const ORDERS_CREATE = passthroughOperation<ShopCreatedOrder>('shop.orders.create');
const ORDERS_LIST = passthroughOperation<{ items: ShopOrderSummary[] }>('shop.orders.list');
const ORDERS_GET = passthroughOperation<ShopOrder | null>('shop.orders.get');
const ORDERS_PAY = passthroughOperation<ShopPayment>('shop.orders.pay');
const ORDERS_REQUEST_ACCESS_CODE = voidOperation('shop.orders.requestAccessCode');
const ORDERS_VERIFY_ACCESS_CODE = passthroughOperation<ShopOrderAccessVerification>(
  'shop.orders.verifyAccessCode',
);
const CONSENTS_RECORD = voidOperation('shop.consents.record');

/** Параметры запроса, который может использовать токен доступа к заказам. */
export interface ShopOrderRequestOptions extends RequestOptions {
  /** Временный токен из проверки кода или `pass` созданного заказа. */
  orderAccessToken?: string | undefined;
  /** `false` запрещает отправлять Bearer-токен ИТД. По умолчанию используется авторизация клиента. */
  useItdAuth?: boolean | undefined;
}

/** Параметры создания заказа. */
export interface CreateShopOrderOptions extends RequestOptions {
  /** Ключ защиты от повторного создания заказа. По умолчанию создаётся автоматически. */
  idempotencyKey?: string | undefined;
}

/** Параметры перехода к оплате. */
export interface PayShopOrderOptions extends ShopOrderRequestOptions {
  /** Адрес возврата после оплаты. */
  returnUrl: string;
}

function orderRequestOptions(options: ShopOrderRequestOptions) {
  const { orderAccessToken, useItdAuth, headers, ...request } = options;
  return {
    ...request,
    ...(useItdAuth === false ? { skipAuth: true } : {}),
    headers: {
      ...headers,
      ...(orderAccessToken ? { 'X-Order-Token': orderAccessToken } : {}),
    },
  };
}

/** Каталог товаров магазина. */
export class ShopProductsResource extends BaseResource {
  /** Загружает все товары. */
  list(options: RequestOptions = {}): Promise<ShopProduct[]> {
    return this.http.execute(PRODUCTS_LIST, {
      path: '/api/v1/shop/products',
      raw: true,
      ...options,
    });
  }

  /** Загружает товар по идентификатору. */
  async get(productId: string, options: RequestOptions = {}): Promise<ShopProduct | null> {
    try {
      return await this.http.execute(PRODUCTS_GET, {
        path: `/api/v1/shop/products/${encodePathSegment(productId, 'идентификатор товара')}`,
        raw: true,
        ...options,
      });
    } catch (error) {
      if (isItdApiError(error) && error.status === 404) return null;
      throw error;
    }
  }
}

/** Расчёт и выбор доставки. */
export class ShopDeliveryResource extends BaseResource {
  /** Загружает страны, в которые доступна доставка. */
  countries(options: RequestOptions = {}): Promise<ShopDeliveryCountry[]> {
    return this.http.execute(DELIVERY_COUNTRIES, {
      path: '/api/v1/shop/delivery/countries',
      raw: true,
      ...options,
    });
  }

  /** Ищет города службы доставки. */
  cities(
    query: string,
    countryCode?: string,
    options: RequestOptions = {},
  ): Promise<ShopDeliveryCity[]> {
    return this.http.execute(DELIVERY_CITIES, {
      path: '/api/v1/shop/delivery/cities',
      query: { q: query, country: countryCode },
      raw: true,
      ...options,
    });
  }

  /** Загружает пункты выдачи в городе. */
  points(cityCode: number, options: RequestOptions = {}): Promise<ShopDeliveryPoint[]> {
    return this.http.execute(DELIVERY_POINTS, {
      path: '/api/v1/shop/delivery/points',
      query: { cityCode },
      raw: true,
      ...options,
    });
  }

  /** Рассчитывает стоимость и срок доставки. */
  calculate(
    items: ShopOrderItemInput[],
    destination: ShopDeliveryDestination,
    options: RequestOptions = {},
  ): Promise<ShopDeliveryCalculation> {
    return this.http.execute(DELIVERY_CALCULATE, {
      path: '/api/v1/shop/delivery/calculate',
      body: { items, to: destination },
      raw: true,
      ...options,
    });
  }
}

/** Создание, просмотр и оплата заказов. */
export class ShopOrdersResource extends BaseResource {
  /** Создаёт заказ. */
  create(
    input: CreateShopOrderInput,
    options: CreateShopOrderOptions = {},
  ): Promise<ShopCreatedOrder> {
    const { idempotencyKey = createDeviceId(), headers, ...request } = options;
    return this.http.execute(ORDERS_CREATE, {
      path: '/api/v1/shop/orders',
      body: input,
      headers: { ...headers, 'Idempotency-Key': idempotencyKey },
      raw: true,
      ...request,
    });
  }

  /** Загружает заказы аккаунта ИТД или владельца временного токена. */
  list(options: ShopOrderRequestOptions = {}): Promise<{ items: ShopOrderSummary[] }> {
    return this.http.execute(ORDERS_LIST, {
      path: '/api/v1/shop/orders/my',
      raw: true,
      ...orderRequestOptions(options),
    });
  }

  /** Загружает заказ по номеру. */
  get(orderNumber: string, options: ShopOrderRequestOptions = {}): Promise<ShopOrder | null> {
    return this.http.execute(ORDERS_GET, {
      path: `/api/v1/shop/orders/${encodePathSegment(orderNumber, 'номер заказа')}`,
      raw: true,
      ...orderRequestOptions(options),
    });
  }

  /** Создаёт ссылку на оплату заказа. */
  pay(orderNumber: string, options: PayShopOrderOptions): Promise<ShopPayment> {
    const { returnUrl, ...access } = options;
    return this.http.execute(ORDERS_PAY, {
      path: `/api/v1/shop/orders/${encodePathSegment(orderNumber, 'номер заказа')}/pay`,
      body: { returnUrl },
      raw: true,
      ...orderRequestOptions(access),
    });
  }

  /** Отправляет на почту код доступа к гостевым заказам. */
  requestAccessCode(email: string, options: RequestOptions = {}): Promise<void> {
    return this.http.execute(ORDERS_REQUEST_ACCESS_CODE, {
      path: '/api/v1/shop/orders/lookup/request',
      body: { email },
      raw: true,
      skipAuth: true,
      ...options,
    });
  }

  /** Проверяет код из письма и возвращает временный токен заказов. */
  verifyAccessCode(
    email: string,
    code: string,
    options: RequestOptions = {},
  ): Promise<ShopOrderAccessVerification> {
    return this.http.execute(ORDERS_VERIFY_ACCESS_CODE, {
      path: '/api/v1/shop/orders/lookup/verify',
      body: { email, code },
      raw: true,
      skipAuth: true,
      ...options,
    });
  }
}

/** Запись согласий магазина. */
export class ShopConsentsResource extends BaseResource {
  /** Записывает согласия покупателя. */
  record(
    consents: ShopConsent[],
    consentContext: ShopConsentContext,
    options: RequestOptions = {},
  ): Promise<void> {
    return this.http.execute(CONSENTS_RECORD, {
      path: '/api/v1/shop/consents',
      body: { consents, consentContext },
      raw: true,
      ...options,
    });
  }
}

/** Магазин ИТД. */
export class ShopResource {
  readonly products: ShopProductsResource;
  readonly delivery: ShopDeliveryResource;
  readonly orders: ShopOrdersResource;
  readonly consents: ShopConsentsResource;

  /** @internal */
  constructor(http: ConstructorParameters<typeof BaseResource>[0]) {
    this.products = new ShopProductsResource(http);
    this.delivery = new ShopDeliveryResource(http);
    this.orders = new ShopOrdersResource(http);
    this.consents = new ShopConsentsResource(http);
  }
}
