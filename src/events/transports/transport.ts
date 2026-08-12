import type { ClientConnection } from '../../core/connection.js';
import type { QueryParams } from '../../core/url.js';

/** Operation IDs emitted by notification transports. */
export type EventOperationId =
  | 'events.notifications.poll.updates'
  | 'events.notifications.poll.unread';

/** Запрос транспорта к конвейеру клиента. */
export interface EventRequestInput {
  operationId: EventOperationId;
  path: string;
  query?: QueryParams | undefined;
  /**
   * Отмена запроса. Transport и доменная синхронизация передают сигнал текущей попытки
   * соединения, поэтому disconnect не оставляет фоновые REST-запросы.
   */
  signal?: AbortSignal | undefined;
}

/**
 * Порт к конвейеру клиента: очередь, авторизация, повторы, плагины и хуки.
 *
 * Ответ приходит уже разобранным и без обёртки `{ data: … }`, а неудача — типизированной
 * ошибкой библиотеки.
 */
export type EventRequest = (input: EventRequestInput) => Promise<unknown>;

/** Событие, пришедшее по каналу реального времени. */
export interface EventTransportFrame {
  /** Имя события: `notification`, `unread_count` и другие. */
  name: string;
  /** Полезная нагрузка, уже разобранная из JSON. */
  data: unknown;
}

/** Что транспорт получает от клиента при подключении. */
export interface EventTransportContext
  extends Pick<ClientConnection, 'baseUrl' | 'authorize' | 'fetch' | 'baseHeaders' | 'getToken'> {
  /** Отмена подключения. */
  signal: AbortSignal;
  /** Сообщает о полученном событии. */
  onEvent: (event: EventTransportFrame) => void;
  /** Сообщает о разобранном, но некорректном сообщении. Соединение при этом живёт. */
  onParseError: (error: unknown, raw: string) => void;
  /** Вызывается, когда соединение установлено. */
  onOpen: () => void;
}

/** Канал получения исходных событий в реальном времени. */
export interface EventTransport {
  /** Понятное имя для логов и диагностики. */
  readonly name: string;

  /**
   * Держит соединение, пока оно живо.
   *
   * Должен завершиться, когда поток закрылся, и бросить исключение при ошибке.
   * Отмена через `context.signal` должна приводить к `AbortError`.
   */
  connect(context: EventTransportContext): Promise<void>;
}

/** Ошибка, по которой видно, что сервер отверг авторизацию потока. */
export class UnauthorizedStreamError extends Error {
  constructor() {
    super('Поток событий отверг токен доступа');
    this.name = 'UnauthorizedStreamError';
  }
}
