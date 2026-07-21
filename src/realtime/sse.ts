import { createParser } from 'eventsource-parser';
import { joinUrl } from '../core/url.js';
import {
  type RealtimeTransport,
  type TransportContext,
  UnauthorizedStreamError,
} from './transport.js';

/** Путь потока уведомлений. */
export const STREAM_PATH = '/api/notifications/stream';

/** Настройки SSE-транспорта. */
export interface SseTransportOptions {
  /**
   * Сколько миллисекунд ждать данных, прежде чем считать соединение мёртвым.
   *
   * Сервер не присылает keep-alive, а оборванное TCP-соединение может не закрыться
   * само — без этой проверки поток «тихо умирает» и новых уведомлений не приходит.
   * По умолчанию 90 000. `0` отключает проверку.
   */
  idleTimeout?: number;
}

/**
 * Транспорт поверх Server-Sent Events.
 *
 * Нативный `EventSource` не подходит: он не умеет отправлять заголовок `Authorization`,
 * а поток требует Bearer-токен. Поэтому используется `fetch` с чтением тела по частям.
 *
 * Разбор кадров делегирован `eventsource-parser`, который корректно обрабатывает
 * многострочный `data:`, перевод строки `\r\n`, `data:` без пробела и кадр, разорванный
 * между сетевыми чанками. В разборе на сайте итд.com каждый из этих случаев обрабатывается
 * неверно.
 */
export class SseTransport implements RealtimeTransport {
  readonly name = 'sse';

  readonly #idleTimeout: number;
  /** Идентификатор последнего события — отправляется при переподключении. */
  #lastEventId: string | undefined;

  constructor(options: SseTransportOptions = {}) {
    this.#idleTimeout = options.idleTimeout ?? 90_000;
  }

  async connect(context: TransportContext): Promise<void> {
    const token = await context.getToken();
    if (!token) throw new UnauthorizedStreamError();

    const headers = new Headers({
      Accept: 'text/event-stream',
      Authorization: `Bearer ${token}`,
      'Cache-Control': 'no-cache',
    });

    // Сервер пока не присылает id, но поддержка не мешает и пригодится, если начнёт.
    if (this.#lastEventId) headers.set('Last-Event-ID', this.#lastEventId);

    const response = await context.fetch(joinUrl(context.baseUrl, STREAM_PATH), {
      method: 'GET',
      headers,
      signal: context.signal,
    });

    if (response.status === 401) throw new UnauthorizedStreamError();
    if (!response.ok) throw new Error(`Поток уведомлений вернул статус ${response.status}`);
    if (!response.body) throw new Error('Ответ потока уведомлений пуст');

    context.onOpen();

    await this.#read(response.body, context);
  }

  async #read(body: ReadableStream<Uint8Array>, context: TransportContext): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();

    const parser = createParser({
      onEvent: (message) => {
        if (message.id) this.#lastEventId = message.id;

        let data: unknown;
        try {
          data = JSON.parse(message.data);
        } catch (error) {
          // Одно битое сообщение не повод рвать соединение.
          context.onParseError(error, message.data);
          return;
        }

        // Имя события может отсутствовать — тогда тип лежит внутри полезной нагрузки.
        const name =
          message.event ??
          (typeof data === 'object' && data !== null && 'type' in data
            ? String((data as { type: unknown }).type)
            : 'message');

        context.onEvent({ name, data });
      },
    });

    let idleTimer: ReturnType<typeof setTimeout> | undefined;

    const armIdleTimer = () => {
      if (this.#idleTimeout <= 0) return;
      if (idleTimer !== undefined) clearTimeout(idleTimer);

      idleTimer = setTimeout(() => {
        // Отмена чтения завершит цикл, и внешний код переподключится.
        void reader.cancel(new Error('Поток молчит дольше допустимого')).catch(() => {});
      }, this.#idleTimeout);
    };

    armIdleTimer();

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        armIdleTimer();
        parser.feed(decoder.decode(value, { stream: true }));
      }
    } finally {
      if (idleTimer !== undefined) clearTimeout(idleTimer);
      reader.releaseLock?.();
    }
  }
}
