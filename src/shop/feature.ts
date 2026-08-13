import { ItdConfigError, isItdApiError } from '../core/errors.js';
import type { ClientFeature, FeatureRequestOptions } from '../core/features.js';
import { RetrySafety, voidResult } from '../core/operation.js';
import type { RequestOptions } from '../core/options.js';
import { encodePathSegment } from '../core/url.js';
import type {
  ShopOrder,
  ShopOrderAccessSession,
  ShopOrderAccessVerification,
  ShopOrderSummary,
  ShopPayment,
} from '../models/shop.js';
import { createMemoryShopOrderAccessStorage, type ShopOrderAccessStorage } from './order-access.js';

const Operation = Object.freeze({
  RequestCode: 'request-code',
  VerifyCode: 'verify-code',
  List: 'list',
  Get: 'get',
  Pay: 'pay',
} as const);

/** Настройки подключаемого модуля доступа к заказам по коду из письма. */
export interface ShopFeatureOptions {
  /** Отдельное хранилище токена заказов. По умолчанию используется память процесса. */
  storage?: ShopOrderAccessStorage | undefined;
}

/** API гостевого доступа к заказам по коду из письма. */
export interface ShopFeatureApi {
  /** Отправляет код и запоминает адрес до проверки. */
  requestCode(email: string, options?: RequestOptions): Promise<void>;
  /** Проверяет код для адреса, переданного в {@link requestCode}. */
  verifyCode(code: string, options?: RequestOptions): Promise<ShopOrderAccessSession>;
  /** Возвращает действующий доступ или `null`. */
  session(): Promise<ShopOrderAccessSession | null>;
  /** Удаляет сохранённый доступ. */
  clear(): Promise<void>;
  /** Загружает гостевые заказы сохранённого адреса. */
  list(options?: RequestOptions): Promise<{ items: ShopOrderSummary[] }>;
  /** Загружает гостевой заказ. */
  get(orderNumber: string, options?: RequestOptions): Promise<ShopOrder | null>;
  /** Создаёт ссылку на оплату гостевого заказа. */
  pay(orderNumber: string, returnUrl: string, options?: RequestOptions): Promise<ShopPayment>;
}

function requireEmail(value: string): string {
  const email = value.trim();
  if (!email?.includes('@')) throw new ItdConfigError('укажите адрес почты');
  return email;
}

/** Создаёт подключаемый модуль для доступа к заказам по коду из письма. */
export function createShopFeature(options: ShopFeatureOptions = {}): ClientFeature<ShopFeatureApi> {
  return {
    name: 'shop',
    buckets: {
      [Operation.RequestCode]: { limit: 4 },
      [Operation.VerifyCode]: { limit: 13 },
      [Operation.List]: { limit: 150 },
      [Operation.Get]: { limit: 150 },
      [Operation.Pay]: { limit: 13 },
    },
    operations: {
      [Operation.RequestCode]: {
        method: 'POST',
        retrySafety: RetrySafety.Unsafe,
        read: voidResult,
        bucket: Operation.RequestCode,
      },
      [Operation.VerifyCode]: {
        method: 'POST',
        retrySafety: RetrySafety.Unsafe,
        bucket: Operation.VerifyCode,
      },
      [Operation.List]: {
        method: 'GET',
        retrySafety: RetrySafety.Safe,
        bucket: Operation.List,
      },
      [Operation.Get]: { method: 'GET', retrySafety: RetrySafety.Safe, bucket: Operation.Get },
      [Operation.Pay]: { method: 'POST', retrySafety: RetrySafety.Unsafe, bucket: Operation.Pay },
    },
    setup(context) {
      const storage = options.storage ?? createMemoryShopOrderAccessStorage();
      let pendingEmail: string | null = null;

      const readSession = async (): Promise<ShopOrderAccessSession | null> => {
        const session = await storage.get();
        if (!session) return null;
        if (session.expiresAt > context.clock.now()) return { ...session };
        await storage.clear();
        return null;
      };

      const requireSession = async (): Promise<ShopOrderAccessSession> => {
        const session = await readSession();
        if (!session) {
          throw new ItdConfigError('доступ к заказам отсутствует или истёк; запросите новый код');
        }
        return session;
      };

      const withAccess = async <T>(run: (token: string) => Promise<T>): Promise<T> => {
        const session = await requireSession();
        try {
          return await run(session.token);
        } catch (error) {
          if (isItdApiError(error) && error.status === 401) await storage.clear();
          throw error;
        }
      };

      const request = <T>(
        operation: string,
        token: string,
        requestOptions: FeatureRequestOptions,
      ) =>
        context.request<T>(operation, {
          ...requestOptions,
          headers: {
            ...requestOptions.headers,
            'X-Order-Token': token,
          },
          skipAuth: true,
          raw: true,
        });

      return {
        api: Object.freeze<ShopFeatureApi>({
          async requestCode(email, requestOptions = {}) {
            const normalized = requireEmail(email);
            await context.request(Operation.RequestCode, {
              path: '/api/v1/shop/orders/lookup/request',
              body: { email: normalized },
              skipAuth: true,
              raw: true,
              ...requestOptions,
            });
            pendingEmail = normalized;
          },
          async verifyCode(code, requestOptions = {}) {
            if (!pendingEmail) {
              throw new ItdConfigError('сначала запросите код для адреса почты');
            }
            const verified = await context.request<ShopOrderAccessVerification>(
              Operation.VerifyCode,
              {
                path: '/api/v1/shop/orders/lookup/verify',
                body: { email: pendingEmail, code },
                skipAuth: true,
                raw: true,
                ...requestOptions,
              },
            );
            const session = {
              email: pendingEmail,
              token: verified.token,
              expiresAt: context.clock.now() + verified.expiresInSec * 1_000,
            };
            await storage.set(session);
            pendingEmail = null;
            return { ...session };
          },
          session: readSession,
          async clear() {
            pendingEmail = null;
            await storage.clear();
          },
          list: (requestOptions = {}) =>
            withAccess((token) =>
              request<{ items: ShopOrderSummary[] }>(Operation.List, token, {
                path: '/api/v1/shop/orders/my',
                ...requestOptions,
              }),
            ),
          get: (orderNumber, requestOptions = {}) =>
            withAccess((token) =>
              request<ShopOrder | null>(Operation.Get, token, {
                path: `/api/v1/shop/orders/${encodePathSegment(orderNumber, 'номер заказа')}`,
                ...requestOptions,
              }),
            ),
          pay: (orderNumber, returnUrl, requestOptions = {}) =>
            withAccess((token) =>
              request<ShopPayment>(Operation.Pay, token, {
                path: `/api/v1/shop/orders/${encodePathSegment(orderNumber, 'номер заказа')}/pay`,
                body: { returnUrl },
                ...requestOptions,
              }),
            ),
        }),
      };
    },
  };
}
