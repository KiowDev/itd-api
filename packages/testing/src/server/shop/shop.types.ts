import type { ShopOrder } from 'itd-api';

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
