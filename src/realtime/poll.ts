import { pickArray, pickNumber } from '../core/unwrap.js';
import { joinUrl } from '../core/url.js';
import type { RealtimeTransport, TransportContext } from './transport.js';
import { UnauthorizedStreamError } from './transport.js';

/** Настройки опроса. */
export interface PollTransportOptions {
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

  constructor(options: PollTransportOptions = {}) {
    this.#interval = options.interval ?? 15_000;
    this.#limit = options.limit ?? 20;
  }

  async connect(context: TransportContext): Promise<void> {
    const seen = new Set<string>();
    let firstRun = true;
    let lastUnreadCount: number | undefined;

    context.onOpen();

    while (!context.signal.aborted) {
      const token = await context.getToken();
      if (!token) throw new UnauthorizedStreamError();

      const headers = new Headers({
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      });

      const response = await context.fetch(
        `${joinUrl(context.baseUrl, '/api/notifications/')}?limit=${this.#limit}&offset=0`,
        { method: 'GET', headers, signal: context.signal },
      );

      if (response.status === 401) throw new UnauthorizedStreamError();
      if (!response.ok) throw new Error(`Опрос уведомлений вернул статус ${response.status}`);

      const body: unknown = await response.json();
      const payload =
        typeof body === 'object' && body !== null && 'data' in body
          ? (body as { data: unknown }).data
          : body;

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

      const count = await this.#readCount(context, headers);
      if (count !== undefined && count !== lastUnreadCount) {
        lastUnreadCount = count;
        context.onEvent({ name: 'unread_count', data: { payload: { count } } });
      }

      firstRun = false;
      await this.#wait(context.signal);
    }
  }

  async #readCount(context: TransportContext, headers: Headers): Promise<number | undefined> {
    try {
      const response = await context.fetch(joinUrl(context.baseUrl, '/api/notifications/count'), {
        method: 'GET',
        headers,
        signal: context.signal,
      });

      if (!response.ok) return undefined;

      const body: unknown = await response.json();
      const payload =
        typeof body === 'object' && body !== null && 'data' in body
          ? (body as { data: unknown }).data
          : body;

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
      const timer = setTimeout(finish, this.#interval);

      function finish() {
        clearTimeout(timer);
        signal.removeEventListener('abort', finish);
        resolve();
      }

      signal.addEventListener('abort', finish, { once: true });
    });
  }
}
