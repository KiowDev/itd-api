import { encodePathSegment } from '../core/url.js';
import type { PaymentMethod, Subscription } from '../models/account.js';
import type { RequestOptions } from '../types/options.js';
import { BaseResource } from './base.js';

/**
 * Подписка и способы оплаты.
 *
 * Доступна как `itd.subscription`.
 */
export class SubscriptionResource extends BaseResource {
  /** Загружает состояние подписки и её цену. */
  status(options: RequestOptions = {}): Promise<Subscription> {
    return this.http.operation<Subscription>('subscription.status', {
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
    return this.http.operation('subscription.pay', {
      path: '/api/v1/subscription/pay',
      ...options,
    });
  }

  /** Включает или отключает автопродление. */
  setAutoRenewal(enabled: boolean, options: RequestOptions = {}): Promise<unknown> {
    return this.http.operation('subscription.setAutoRenewal', {
      path: '/api/v1/subscription/auto-renewal',
      body: { enabled },
      ...options,
    });
  }

  /** Запускает привязку карты. */
  bindCard(options: RequestOptions = {}): Promise<unknown> {
    return this.http.operation('subscription.bindCard', {
      path: '/api/v1/subscription/bind-card',
      ...options,
    });
  }

  /** Загружает список способов оплаты. Пустой массив, если карт нет. */
  async methods(options: RequestOptions = {}): Promise<PaymentMethod[]> {
    const body = await this.http.operation('subscription.methods', {
      path: '/api/v1/subscription/methods',
      ...options,
    });

    return Array.isArray(body) ? (body as PaymentMethod[]) : [];
  }

  /** Делает способ оплаты основным. */
  setDefaultMethod(methodId: string, options: RequestOptions = {}): Promise<unknown> {
    return this.http.operation('subscription.setDefaultMethod', {
      path: `/api/v1/subscription/methods/${encodePathSegment(methodId, 'methodId')}/default`,
      ...options,
    });
  }

  /** Удаляет способ оплаты. */
  removeMethod(methodId: string, options: RequestOptions = {}): Promise<void> {
    return this.http.operation<void>('subscription.removeMethod', {
      path: `/api/v1/subscription/methods/${encodePathSegment(methodId, 'methodId')}`,
      ...options,
    });
  }
}
