import { installAsyncDisposeFallback } from '../core/async-dispose.js';
import { type AuthProvider, anonymousAuth, bearerToken } from '../core/auth-provider.js';
import { ItdStateError } from '../core/errors.js';
import { type ClientRuntime, createClientRuntime } from '../core/execution/client-runtime.js';
import type { RuntimeOptions } from '../core/options.js';
import { pickNumber } from '../core/unwrap.js';
import { ITD_CATALOG } from '../domain/catalog.js';
import {
  NotificationEvents,
  type NotificationEventsDeps,
  type NotificationEventsOptions,
  setNotificationEventsConnectGuard,
} from './stream.js';
import type { NotificationEventContext } from './updates.js';

/** Опции конструктора {@link NotificationEventsClient}. */
export interface NotificationEventsClientOptions<
  C extends NotificationEventContext = NotificationEventContext,
> extends RuntimeOptions,
    NotificationEventsOptions<C> {
  /**
   * Авторизация. Строка — сокращение для `bearerToken()`.
   *
   * Без неё поток идёт анонимно. Токен считается готовым: продлевать его клиент не умеет,
   * а на отказ авторизации переподключение спрашивает токен заново. Сессия, которая входит
   * по паролю и продлевает себя сама, живёт в полном `ItdClient`.
   */
  auth?: string | AuthProvider | undefined;
}

/**
 * Поток уведомлений с собственным конвейером запросов.
 *
 * Тот же {@link NotificationEvents}, что доступен как `itd.notifications.events`, но собранный без полного клиента:
 * ресурсы, билдеры и сессия сюда не входят. Нужен приложениям, которым от API нужны только
 * события, — виджетам, счётчикам непрочитанного, фоновым слушателям.
 *
 * @example
 * ```ts
 * import { createNotificationEventsClient } from 'itd-api/events';
 *
 * await using stream = createNotificationEventsClient({ auth: token });
 * stream.on('notification', ({ notification }) => console.log(notification.type));
 * await stream.connect();
 * ```
 */
export class NotificationEventsClient<
  C extends NotificationEventContext = NotificationEventContext,
> extends NotificationEvents<C> {
  readonly #runtime: ClientRuntime;
  /** Общий результат терминальной очистки для идемпотентных повторных вызовов. */
  #disposePromise: Promise<void> | undefined;
  #disposed = false;

  constructor(options: NotificationEventsClientOptions<C> = {}) {
    const runtime = createClientRuntime(options, {
      catalog: ITD_CATALOG,
      auth: () => resolveAuthProvider(options.auth),
    });

    super(notificationEventsDeps(runtime), options);
    this.#runtime = runtime;

    setNotificationEventsConnectGuard<C>(this, () => {
      if (!this.#disposed) return;
      throw new ItdStateError(
        'Поток уже окончательно освобождён через dispose(); нельзя подключить его снова. ' +
          'Создайте новый',
      );
    });
  }

  /**
   * Окончательно освобождает поток и его конвейер: отключает соединение, дожидается
   * обработчиков и останавливает очередь запросов.
   *
   * Повторные вызовы возвращают тот же результат очистки.
   */
  dispose(): Promise<void> {
    if (this.#disposePromise) return this.#disposePromise;
    this.#disposed = true;
    this.#disposePromise = this.#dispose();
    return this.#disposePromise;
  }

  async #dispose(): Promise<void> {
    const errors: unknown[] = [];
    this.disconnect();
    try {
      await this.drain();
    } catch (error) {
      errors.push(error);
    }
    try {
      this.#runtime.close();
      await this.#runtime.dispose();
    } catch (error) {
      errors.push(error);
    }
    if (errors.length > 0) throw new AggregateError(errors, 'Не удалось освободить поток');
  }

  /** Позволяет использовать поток с `await using`. */
  [Symbol.asyncDispose](): Promise<void> {
    return this.dispose();
  }

  static {
    installAsyncDisposeFallback(NotificationEventsClient);
  }
}

/** Приводит опцию `auth` к провайдеру конвейера. */
function resolveAuthProvider(auth: NotificationEventsClientOptions['auth']): AuthProvider {
  if (auth === undefined) return anonymousAuth();
  return typeof auth === 'string' ? bearerToken(auth) : auth;
}

/**
 * Связывает поток с собранным конвейером.
 *
 * Начальный счётчик непрочитанных берётся той же операцией, что и при опросе
 * (`events.notifications.poll.unread`): ресурс уведомлений потоку для этого не нужен.
 */
function notificationEventsDeps(runtime: ClientRuntime): NotificationEventsDeps {
  const request: NonNullable<NotificationEventsDeps['request']> = ({
    operationId,
    path,
    query,
    signal,
  }) => runtime.http.operation(operationId, { path, query, signal });

  return {
    connection: runtime.connection(),
    clock: runtime.config.clock,
    logger: runtime.config.logger,
    request,
    fetchUnreadCount: async (signal) => {
      const payload = await request({
        operationId: 'events.notifications.poll.unread',
        path: '/api/notifications/count',
        signal,
      });
      return pickNumber(payload, 'count', 0);
    },
  };
}

/**
 * Создаёт поток уведомлений с собственным конвейером. Равнозначно конструктору
 * {@link NotificationEventsClient}.
 */
export function createNotificationEventsClient<
  C extends NotificationEventContext = NotificationEventContext,
>(options: NotificationEventsClientOptions<C> = {}): NotificationEventsClient<C> {
  return new NotificationEventsClient<C>(options);
}
