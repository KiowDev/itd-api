import type { RuntimeOptions } from './core/options.js';
import type { NotificationEventsOptions } from './events/stream.js';
import type { SessionOptions } from './session/options.js';

/**
 * Опции конструктора `ItdClient`.
 *
 * Полный SDK — composition root: он объединяет настройки исполнения запросов
 * ({@link RuntimeOptions}) и настройки сессии ({@link SessionOptions}). Разделены они
 * не для пользователя, а для сборки: ядру нужна только первая половина, и знать про
 * вторую оно не должно.
 *
 * @example
 * ```ts
 * const itd = new ItdClient({
 *   auth: { email, password },              // SessionOptions
 *   captcha: createCaptchaSolver(),         // SessionOptions
 *   rateLimit: { concurrency: 4, rps: 8 },  // RuntimeOptions
 * });
 * ```
 */
export interface ItdClientOptions extends RuntimeOptions, SessionOptions {
  /** Неизменяемые настройки предметных каналов событий клиента. */
  events?:
    | {
        /** Настройки канала уведомлений на всё время жизни клиента. */
        notifications?: NotificationEventsOptions | undefined;
      }
    | undefined;
}
