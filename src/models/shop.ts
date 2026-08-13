import type { Loose } from '../types/enums.js';
import type { IsoDate } from './common.js';

/** Категория товара магазина. */
export const ShopProductCategory = Object.freeze({
  Apparel: 'apparel',
  Accessories: 'accessories',
  Print: 'print',
} as const);
export type ShopProductCategory = Loose<
  (typeof ShopProductCategory)[keyof typeof ShopProductCategory]
>;

/** Состояние товара в каталоге. */
export const ShopProductStatus = Object.freeze({
  Available: 'available',
  Preorder: 'preorder',
  SoldOut: 'soldout',
} as const);
export type ShopProductStatus = Loose<(typeof ShopProductStatus)[keyof typeof ShopProductStatus]>;

/** Вариант цвета товара. */
export interface ShopProductColor {
  id: string;
  label: string;
  hex: string;
  images: string[];
}

/** Характеристика товара. */
export interface ShopProductSpec {
  label: string;
  value: string;
}

/** Строка таблицы размеров. */
export interface ShopSizeChartRow {
  size: string;
  values: string[];
}

/** Таблица размеров товара. */
export interface ShopSizeChart {
  columns: string[];
  rows: ShopSizeChartRow[];
  note?: string | undefined;
}

/** Товар магазина. Цены указаны в рублях. */
export interface ShopProduct {
  id: string;
  title: string;
  category: ShopProductCategory;
  price: number;
  images: string[];
  sizes: string[];
  colors: ShopProductColor[];
  description: string;
  specs: ShopProductSpec[];
  sizeChart?: ShopSizeChart | null | undefined;
  status: ShopProductStatus;
  stockLeft: number | null;
}

/** Позиция для расчёта доставки или создания заказа. */
export interface ShopOrderItemInput {
  productId: string;
  size: string | null;
  color: string | null;
  qty: number;
}

/** Страна, в которую доступна доставка. */
export interface ShopDeliveryCountry {
  code: string;
  name: string;
}

/** Город из подсказок службы доставки. */
export interface ShopDeliveryCity {
  code: number;
  name: string;
  countryCode: string;
}

/** Пункт выдачи заказа. */
export interface ShopDeliveryPoint {
  code: string;
  name: string;
  city: string;
  cityCode: number;
  countryCode: string;
  postalCode: string;
  address: string;
  latitude: number;
  longitude: number;
  workTime?: string | undefined;
  metro?: string | undefined;
  note?: string | undefined;
  dressingRoom: boolean;
  card: boolean;
  cash: boolean;
}

/** Направление для расчёта доставки. */
export interface ShopDeliveryDestination {
  code: number;
  countryCode: string;
}

/** Стоимость и ожидаемый срок доставки. */
export interface ShopDeliveryCalculation {
  /** Стоимость доставки в копейках. */
  costKopecks: number;
  /** Стоимость доставки в рублях. */
  cost: number;
  periodMin: number;
  periodMax: number;
  tariffCode: number;
  tariffName: string;
  weightGrams: number;
}

/** Данные получателя заказа. */
export interface ShopRecipient {
  name: string;
  phone: string;
  email: string;
  country: string;
  city: string;
  address: string;
  cityCode: number | null;
  deliveryPoint: string;
  comment: string;
}

/** Вид согласия, которое принимает покупатель. */
export const ShopConsentKind = Object.freeze({
  Offer: 'offer',
  PersonalData: 'personal_data',
  Cookie: 'cookie',
} as const);
export type ShopConsentKind = (typeof ShopConsentKind)[keyof typeof ShopConsentKind];

/** Принятое или отклонённое условие магазина. */
export interface ShopConsent {
  kind: ShopConsentKind;
  accepted: boolean;
  docSlug: string;
  docVersion: string;
}

/** Место, в котором было получено согласие. */
export interface ShopConsentContext {
  form: string;
  page: string;
  visitorId: string;
}

/** Данные для создания заказа. */
export interface CreateShopOrderInput {
  items: ShopOrderItemInput[];
  recipient: ShopRecipient;
  consents: ShopConsent[];
  consentContext: ShopConsentContext;
}

/** Результат создания заказа. */
export interface ShopCreatedOrder {
  number: string;
  /** Токен для открытия только что созданного гостевого заказа. */
  pass?: string | undefined;
}

/** Состояние заказа. */
export const ShopOrderStatus = Object.freeze({
  New: 'new',
  Paid: 'paid',
  Shipping: 'ship',
  Done: 'done',
  Cancelled: 'cancelled',
  Refunded: 'refunded',
  Expired: 'expired',
} as const);
export type ShopOrderStatus = Loose<(typeof ShopOrderStatus)[keyof typeof ShopOrderStatus]>;

/** Заказ в списке заказов. */
export interface ShopOrderSummary {
  number: string;
  titles: string[];
  status: ShopOrderStatus;
  total: number;
  createdAt: IsoDate;
}

/** Товар в оформленном заказе. */
export interface ShopOrderItem {
  slug: string;
  title: string;
  color?: string | null | undefined;
  size?: string | null | undefined;
  qty: number;
  sum: number;
}

/** Адрес доставки оформленного заказа. */
export interface ShopOrderDelivery {
  city: string;
  address: string;
  point?: string | null | undefined;
}

/** Контакты поддержки магазина. */
export interface ShopOrderSupport {
  email: string;
  telegram?: string | undefined;
}

/** Оформленный заказ. */
export interface ShopOrder {
  number: string;
  status: ShopOrderStatus;
  createdAt: IsoDate;
  payment: { pending: boolean };
  items: ShopOrderItem[];
  itemsTotal: number;
  shipping: number;
  total: number;
  delivery: ShopOrderDelivery;
  track?: string | null | undefined;
  comment?: string | null | undefined;
  support?: ShopOrderSupport | null | undefined;
}

/** Ссылка на страницу оплаты. */
export interface ShopPayment {
  url: string;
}

/** Временный доступ к гостевым заказам. */
export interface ShopOrderAccessSession {
  email: string;
  token: string;
  expiresAt: number;
}

/** Ответ проверки кода из письма. */
export interface ShopOrderAccessVerification {
  token: string;
  expiresInSec: number;
}
