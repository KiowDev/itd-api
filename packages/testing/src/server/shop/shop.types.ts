import type { ShopOrder, ShopOrderItemInput } from 'itd-api';

/** Заказ магазина в хранилище mock-server. @internal */
export interface ShopOrderRecord {
  value: ShopOrder;
  userId?: string;
  email: string;
  accessToken?: string;
}

/** Доступ к заказам по коду из письма. @internal */
export interface ShopAccessRecord {
  email: string;
  expiresAt: number;
}

/** Результат создания заказа, повторяемый по ключу идемпотентности. @internal */
export interface ShopOrderReceipt {
  number: string;
  pass?: string;
}

/** Чем покупатель подтверждает доступ к заказам. @internal */
export interface ShopCredentials {
  userId?: string | undefined;
  /** Пропуск заказа или токен доступа по коду из письма. */
  token?: string | null | undefined;
}

/** Выданный по коду из письма доступ. @internal */
export interface ShopAccessGrant {
  token: string;
  expiresInSec: number;
}

/** Получатель нового заказа: поля, которые учитывает магазин mock-server. @internal */
export interface NewShopOrderRecipient {
  email: string;
  city: string;
  address: string;
  deliveryPoint: string | null;
  comment: string | null;
}

/** Новый заказ после разбора тела запроса. @internal */
export interface NewShopOrder {
  items: ShopOrderItemInput[];
  recipient: NewShopOrderRecipient;
}

/** Кто оформляет заказ и с каким ключом идемпотентности. @internal */
export interface ShopOrderContext {
  userId?: string | undefined;
  idempotencyKey?: string | null;
}
