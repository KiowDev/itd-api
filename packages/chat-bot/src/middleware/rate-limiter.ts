import { ItdConfigError } from 'itd-api';
import type { ChatContext } from '../context/context.js';
import { isIncomingMessage } from './filters.js';
import type { ChatMiddleware, ChatMiddlewareObj } from './middleware.js';
import type { RateLimiterOptions } from './rate-limiter.types.js';

const MAX_ACTIVE_KEYS = 10_000;

interface RateWindow {
  expiresAt: number;
  count: number;
  notified: boolean;
}

/**
 * Ограничивает частоту обработки событий в цепочке. Счётчики хранятся в памяти экземпляра.
 * При 10 000 активных ключей события с новыми ключами проходят без проверки до освобождения места.
 */
export class RateLimiter<C extends ChatContext = ChatContext> implements ChatMiddlewareObj<C> {
  readonly #limit: number;
  readonly #window: number;
  readonly #key: NonNullable<RateLimiterOptions<C>['key']>;
  readonly #onLimit: RateLimiterOptions<C>['onLimit'];
  readonly #windows = new Map<string, RateWindow>();

  /** Создаёт ограничитель с независимыми окнами для каждого ключа. */
  constructor({ limit, window, key, onLimit }: RateLimiterOptions<C>) {
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw new ItdConfigError('RateLimiter.limit должен быть положительным целым числом');
    }
    if (!Number.isSafeInteger(window) || window < 1) {
      throw new ItdConfigError('RateLimiter.window должен быть положительным целым числом (мс)');
    }
    if (key !== undefined && typeof key !== 'function') {
      throw new ItdConfigError('RateLimiter.key должен быть функцией');
    }
    if (onLimit !== undefined && typeof onLimit !== 'function') {
      throw new ItdConfigError('RateLimiter.onLimit должен быть функцией');
    }
    this.#limit = limit;
    this.#window = window;
    this.#key = key ?? ((context) => (isIncomingMessage(context) ? context.senderId : undefined));
    this.#onLimit = onLimit;
  }

  /** Возвращает обработчик для `use()`. При превышении лимита завершает цепочку. */
  middleware(): ChatMiddleware<C> {
    return this.#handle;
  }

  readonly #handle: ChatMiddleware<C> = async (context, next) => {
    const key = this.#key(context);
    if (key === undefined) return next();

    const now = performance.now();
    const window = this.#windows.get(key);
    if (!window || window.expiresAt <= now) {
      // У окон одинаковая длительность, поэтому порядок вставки совпадает с порядком истечения.
      for (const [expiredKey, candidate] of this.#windows) {
        if (candidate.expiresAt > now) break;
        this.#windows.delete(expiredKey);
      }
      if (this.#windows.size < MAX_ACTIVE_KEYS) {
        this.#windows.set(key, { expiresAt: now + this.#window, count: 1, notified: false });
      }
      return next();
    }
    if (window.count < this.#limit) {
      window.count++;
      return next();
    }
    if (!window.notified && this.#onLimit) {
      window.notified = true;
      await this.#onLimit(context);
    }
  };
}
