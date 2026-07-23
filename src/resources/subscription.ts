import { encodePathSegment } from '../core/url.js';
import type { PaymentMethod, Subscription } from '../types/models.js';
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
    return this.http.request<Subscription>({
      method: 'GET',
      // Завершающий слэш обязателен.
      path: '/api/v1/subscription/',
      ...this.requestOptions(options),
    });
  }

  /**
   * Запускает оплату подписки.
   *
   * Форма ответа в документации API не описана, поэтому тип результата не уточняется.
   */
  pay(options: RequestOptions = {}): Promise<unknown> {
    return this.http.request({
      method: 'POST',
      path: '/api/v1/subscription/pay',
      ...this.requestOptions(options),
    });
  }

  /** Включает или отключает автопродление. */
  setAutoRenewal(enabled: boolean, options: RequestOptions = {}): Promise<unknown> {
    return this.http.request({
      method: 'POST',
      path: '/api/v1/subscription/auto-renewal',
      body: { enabled },
      ...this.requestOptions(options),
    });
  }

  /** Запускает привязку карты. */
  bindCard(options: RequestOptions = {}): Promise<unknown> {
    return this.http.request({
      method: 'POST',
      path: '/api/v1/subscription/bind-card',
      ...this.requestOptions(options),
    });
  }

  /** Загружает список способов оплаты. Пустой массив, если карт нет. */
  async methods(options: RequestOptions = {}): Promise<PaymentMethod[]> {
    const body = await this.http.request({
      method: 'GET',
      path: '/api/v1/subscription/methods',
      ...this.requestOptions(options),
    });

    return Array.isArray(body) ? (body as PaymentMethod[]) : [];
  }

  /** Делает способ оплаты основным. */
  setDefaultMethod(methodId: string, options: RequestOptions = {}): Promise<unknown> {
    return this.http.request({
      method: 'POST',
      path: `/api/v1/subscription/methods/${encodePathSegment(methodId, 'methodId')}/default`,
      ...this.requestOptions(options),
    });
  }

  /** Удаляет способ оплаты. */
  removeMethod(methodId: string, options: RequestOptions = {}): Promise<void> {
    return this.http.request<void>({
      method: 'DELETE',
      path: `/api/v1/subscription/methods/${encodePathSegment(methodId, 'methodId')}`,
      ...this.requestOptions(options),
    });
  }
}
