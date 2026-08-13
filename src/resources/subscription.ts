import type { RequestOptions } from '../core/options.js';
import { encodePathSegment } from '../core/url.js';
import { defineBuiltInOperation } from '../domain/operations.js';
import type { PaymentMethod, Subscription } from '../models/account.js';
import { passthroughOperation, voidOperation } from '../operations/common.js';
import { BaseResource } from './base.js';

const SUBSCRIPTION_METHODS = defineBuiltInOperation<PaymentMethod[]>(
  'subscription.methods',
  (body) => (Array.isArray(body) ? (body as PaymentMethod[]) : []),
);
const SUBSCRIPTION_STATUS = passthroughOperation<Subscription>('subscription.status');
const SUBSCRIPTION_PAY = passthroughOperation<unknown>('subscription.pay');
const SUBSCRIPTION_SET_AUTO_RENEWAL = passthroughOperation<unknown>('subscription.setAutoRenewal');
const SUBSCRIPTION_BIND_CARD = passthroughOperation<unknown>('subscription.bindCard');
const SUBSCRIPTION_SET_DEFAULT_METHOD = passthroughOperation<unknown>(
  'subscription.setDefaultMethod',
);
const SUBSCRIPTION_REMOVE_METHOD = voidOperation('subscription.removeMethod');

/**
 * Подписка и способы оплаты.
 *
 * Доступна как `itd.subscription`.
 */
export class SubscriptionResource extends BaseResource {
  /** Загружает состояние подписки и её цену. */
  status(options: RequestOptions = {}): Promise<Subscription> {
    return this.http.execute(SUBSCRIPTION_STATUS, {
      // Завершающий слэш обязателен.
      path: '/api/v1/subscription/',
      ...options,
    });
  }

  /**
   * Запускает оплату подписки.
   *
   * Форма ответа в документации API не описана, поэтому тип результата не уточняется.
   */
  pay(options: RequestOptions = {}): Promise<unknown> {
    return this.http.execute(SUBSCRIPTION_PAY, {
      path: '/api/v1/subscription/pay',
      ...options,
    });
  }

  /** Включает или отключает автопродление. */
  setAutoRenewal(enabled: boolean, options: RequestOptions = {}): Promise<unknown> {
    return this.http.execute(SUBSCRIPTION_SET_AUTO_RENEWAL, {
      path: '/api/v1/subscription/auto-renewal',
      body: { enabled },
      ...options,
    });
  }

  /** Запускает привязку карты. */
  bindCard(options: RequestOptions = {}): Promise<unknown> {
    return this.http.execute(SUBSCRIPTION_BIND_CARD, {
      path: '/api/v1/subscription/bind-card',
      ...options,
    });
  }

  /** Загружает список способов оплаты. Пустой массив, если карт нет. */
  methods(options: RequestOptions = {}): Promise<PaymentMethod[]> {
    return this.http.execute(SUBSCRIPTION_METHODS, {
      path: '/api/v1/subscription/methods',
      ...options,
    });
  }

  /** Делает способ оплаты основным. */
  setDefaultMethod(methodId: string, options: RequestOptions = {}): Promise<unknown> {
    return this.http.execute(SUBSCRIPTION_SET_DEFAULT_METHOD, {
      path: `/api/v1/subscription/methods/${encodePathSegment(methodId, 'methodId')}/default`,
      ...options,
    });
  }

  /** Удаляет способ оплаты. */
  removeMethod(methodId: string, options: RequestOptions = {}): Promise<void> {
    return this.voidOperation(SUBSCRIPTION_REMOVE_METHOD, {
      path: `/api/v1/subscription/methods/${encodePathSegment(methodId, 'methodId')}`,
      ...options,
    });
  }
}
