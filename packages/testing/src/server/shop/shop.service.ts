import {
  type CreateShopOrderInput,
  type ShopOrder,
  type ShopOrderItem,
  ShopOrderStatus,
  type ShopProduct,
} from 'itd-api';
import { MockErrorCode } from '../shared/domain.constants.js';
import { MockDomainError } from '../shared/domain.errors.js';
import type { MockStore } from '../store/mock.store.js';
import type {
  ShopAccessGrant,
  ShopCredentials,
  ShopOrderReceipt,
  ShopOrderRecord,
} from './shop.types.js';

const ACCESS_CODE = '123456';
const ACCESS_TTL_SEC = 600;
const SHIPPING = 500;

/** Каталог, заказы и доступ к ним без аккаунта. @internal */
export class ShopService {
  readonly #store: MockStore;

  constructor(store: MockStore) {
    this.#store = store;
  }

  products(): ShopProduct[] {
    return [...this.#store.shopProducts.values()];
  }

  requireProduct(productId: string): ShopProduct {
    const product = this.#store.shopProducts.get(productId);
    if (!product) throw MockDomainError.notFound('Товар не найден');
    return product;
  }

  /**
   * Создаёт заказ. Повтор с тем же ключом идемпотентности возвращает прежний результат,
   * неизвестный товар — `404`.
   */
  createOrder(
    input: CreateShopOrderInput,
    options: { userId?: string | undefined; idempotencyKey?: string | null },
  ): ShopOrderReceipt {
    const previous = options.idempotencyKey
      ? this.#store.shopIdempotency.get(options.idempotencyKey)
      : undefined;
    if (previous) return previous;

    const items = this.#orderItems(input);
    const itemsTotal = items.reduce((sum, item) => sum + item.sum, 0);
    const number = this.#store.nextShopOrderNumber();
    const pass = options.userId ? undefined : `order-pass-${number}`;
    const value: ShopOrder = {
      number,
      status: ShopOrderStatus.New,
      createdAt: this.#store.now(),
      payment: { pending: false },
      items,
      itemsTotal,
      shipping: SHIPPING,
      total: itemsTotal + SHIPPING,
      delivery: {
        city: input.recipient.city,
        address: input.recipient.address,
        point: input.recipient.deliveryPoint || null,
      },
      comment: input.recipient.comment || null,
      track: null,
      support: { email: 'shop@example.test' },
    };
    this.#store.shopOrders.set(number, {
      value,
      email: input.recipient.email.trim().toLowerCase(),
      ...(options.userId ? { userId: options.userId } : {}),
      ...(pass ? { accessToken: pass } : {}),
    });
    const receipt: ShopOrderReceipt = { number, ...(pass ? { pass } : {}) };
    if (options.idempotencyKey) this.#store.shopIdempotency.set(options.idempotencyKey, receipt);
    return receipt;
  }

  /** Обменивает код из письма на временный доступ ко всем заказам этого адреса. */
  grantAccess(email: unknown, code: unknown): ShopAccessGrant {
    if (typeof email !== 'string' || code !== ACCESS_CODE) {
      throw MockDomainError.badRequest(MockErrorCode.InvalidCode, 'Неверный код');
    }
    const normalized = email.trim().toLowerCase();
    const now = this.#store.clock.now();
    const token = `shop-access-${normalized}-${now}`;
    this.#store.shopAccess.set(token, {
      email: normalized,
      expiresAt: now + ACCESS_TTL_SEC * 1_000,
    });
    return { token, expiresInSec: ACCESS_TTL_SEC };
  }

  /** Заказы, доступные по любому из предъявленных способов. */
  ordersFor(credentials: ShopCredentials): ShopOrderRecord[] {
    const email = this.#accessEmail(credentials.token);
    const orders = [...this.#store.shopOrders.values()];
    const hasOrderPass =
      !!credentials.token && orders.some((order) => order.accessToken === credentials.token);
    if (!credentials.userId && !email && !hasOrderPass) {
      throw MockDomainError.unauthorized('Нужна авторизация');
    }
    return orders.filter((order) => this.#matches(order, credentials, email));
  }

  findOrder(number: string): ShopOrderRecord | undefined {
    return this.#store.shopOrders.get(number);
  }

  /** Заказ, к которому у покупателя есть доступ. */
  requireAccessibleOrder(number: string, credentials: ShopCredentials): ShopOrderRecord {
    const order = this.findOrder(number);
    if (!order) throw new MockDomainError(404, MockErrorCode.OrderNotFound, 'Заказ не найден');
    this.assertAccess(order, credentials);
    return order;
  }

  assertAccess(order: ShopOrderRecord, credentials: ShopCredentials): void {
    if (!this.#matches(order, credentials, this.#accessEmail(credentials.token))) {
      throw MockDomainError.unauthorized('Нет доступа к заказу');
    }
  }

  paymentUrl(order: ShopOrderRecord): string {
    return `https://payment.example.test/${order.value.number}`;
  }

  #matches(
    order: ShopOrderRecord,
    credentials: ShopCredentials,
    email: string | undefined,
  ): boolean {
    return (
      (credentials.userId !== undefined && order.userId === credentials.userId) ||
      (email !== undefined && order.email === email) ||
      (!!credentials.token && order.accessToken === credentials.token)
    );
  }

  /** Адрес из действующего доступа по коду. Истёкший доступ удаляется. */
  #accessEmail(token: string | null | undefined): string | undefined {
    if (!token) return undefined;
    const access = this.#store.shopAccess.get(token);
    if (!access) return undefined;
    if (access.expiresAt > this.#store.clock.now()) return access.email;
    this.#store.shopAccess.delete(token);
    return undefined;
  }

  #orderItems(input: CreateShopOrderInput): ShopOrderItem[] {
    return input.items.map((item) => {
      const product = this.requireProduct(item.productId);
      return {
        slug: item.productId,
        title: product.title,
        color: item.color ?? null,
        size: item.size ?? null,
        qty: item.qty,
        sum: product.price * item.qty,
      };
    });
  }
}
