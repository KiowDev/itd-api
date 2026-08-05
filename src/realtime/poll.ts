import { type ItdClock, systemClock } from '../core/clock.js';
import { ItdConfigError, isItdAuthError } from '../core/errors.js';
import { pickArray, pickNumber } from '../core/unwrap.js';
import type { RealtimeRequest, RealtimeTransport, TransportContext } from './transport.js';
import { UnauthorizedStreamError } from './transport.js';

/** Настройки опроса. */
export interface PollTransportOptions {
  /** Часы опроса. Обычно подменяются только в тестах. */
  clock?: ItdClock;
  /** Как часто опрашивать сервер, мс. По умолчанию 15 000. */
  interval?: number;
  /** Сколько уведомлений запрашивать за раз. По умолчанию 20. */
  limit?: number;
}

/**
 * Запасной транспорт: обычный опрос REST вместо потока.
 *
 * Нужен там, где `fetch` не умеет отдавать тело по частям, — например в части сборок
 * React Native. Наружу выдаёт те же события, что и {@link SseTransport}, поэтому
 * вызывающий код разницы не замечает.
 *
 * Новыми считаются уведомления, которых не было в предыдущем ответе; чтобы список
 * известных не рос бесконечно, он ограничен последними двумя страницами.
 */
export class PollTransport implements RealtimeTransport {
  readonly name = 'poll';

  readonly #interval: number;
  readonly #limit: number;
  readonly #clock: ItdClock;

  constructor(options: PollTransportOptions = {}) {
    this.#clock = options.clock ?? systemClock;
    this.#interval = options.interval ?? 15_000;
    this.#limit = options.limit ?? 20;
  }

  async connect(context: TransportContext): Promise<void> {
    const request = context.request;
    if (!request) {
      throw new ItdConfigError(
        'опрос уведомлений выполняется через конвейер клиента; создайте поток вызовом itd.realtime()',
      );
    }

    const seen = new Set<string>();
    let firstRun = true;
    let lastUnreadCount: number | undefined;

    while (!context.signal.aborted) {
      const payload = await this.#readUpdates(request, context.signal);

      // Соединение считается установленным только после первого успешного ответа: иначе
      // при постоянно недоступной сети каждая попытка обнуляла бы счётчик и maxAttempts
      // не срабатывал бы никогда.
      context.onOpen();

      const items = pickArray<Record<string, unknown>>(payload, 'notifications');

      for (const item of [...items].reverse()) {
        const id = typeof item.id === 'string' ? item.id : undefined;
        if (!id || seen.has(id)) continue;

        seen.add(id);
        // На первом проходе список уже существующих уведомлений не считается новыми
        // событиями: иначе подключение сразу выдало бы всю историю.
        if (!firstRun) context.onEvent({ name: 'notification', data: { payload: item } });
      }

      // Ограничиваем память: держим только последние две страницы идентификаторов.
      if (seen.size > this.#limit * 2) {
        const excess = [...seen].slice(0, seen.size - this.#limit * 2);
        for (const id of excess) seen.delete(id);
      }

      const count = await this.#readCount(request, context.signal);
      if (count !== undefined && count !== lastUnreadCount) {
        lastUnreadCount = count;
        context.onEvent({ name: 'unread_count', data: { payload: { count } } });
      }

      firstRun = false;
      await this.#wait(context.signal);
    }
  }

  async #readUpdates(request: RealtimeRequest, signal: AbortSignal): Promise<unknown> {
    try {
      return await request({
        operationId: 'realtime.poll.updates',
        path: '/api/notifications/',
        query: { limit: this.#limit, offset: 0 },
        signal,
      });
    } catch (error) {
      // Конвейер уже попытался обновить токен; для потока это тот же отказ авторизации,
      // что и `401` от сервера событий.
      if (isItdAuthError(error)) throw new UnauthorizedStreamError();
      throw error;
    }
  }

  async #readCount(request: RealtimeRequest, signal: AbortSignal): Promise<number | undefined> {
    try {
      const payload = await request({
        operationId: 'realtime.poll.unread',
        path: '/api/notifications/count',
        signal,
      });
      return pickNumber(payload, 'count', 0);
    } catch {
      // Счётчик — вспомогательная величина: его недоступность не должна рвать опрос.
      return undefined;
    }
  }

  /** Ждёт следующего опроса, прерываясь при отмене. */
  #wait(signal: AbortSignal): Promise<void> {
    // Подписка на уже сработавший сигнал не вызывается никогда — без этой проверки
    // отмена, пришедшая перед самым ожиданием, стоила бы лишнего интервала.
    if (signal.aborted) return Promise.resolve();

    return new Promise<void>((resolve) => {
      const cancel = this.#clock.schedule(finish, this.#interval);

      function finish() {
        cancel();
        signal.removeEventListener('abort', finish);
        resolve();
      }

      signal.addEventListener('abort', finish, { once: true });
    });
  }
}
