import type { QueryParams } from '../core/url.js';
import type { BuiltInOperationId } from '../domain/operations.js';

/** Запрос транспорта к конвейеру клиента. */
export interface RealtimeRequestInput {
  operationId: BuiltInOperationId;
  path: string;
  query?: QueryParams | undefined;
  /**
   * Отмена запроса. Опрос передаёт сигнал своего соединения; разовое чтение счётчика
   * непрочитанных отменять нечем — оно живёт вне цикла соединения.
   */
  signal?: AbortSignal | undefined;
}

/**
 * Порт к конвейеру клиента: очередь, авторизация, повторы, плагины и хуки.
 *
 * Ответ приходит уже разобранным и без обёртки `{ data: … }`, а неудача — типизированной
 * ошибкой библиотеки.
 */
export type RealtimeRequest = (input: RealtimeRequestInput) => Promise<unknown>;

/** Событие, пришедшее по каналу реального времени. */
export interface TransportEvent {
  /** Имя события: `notification`, `unread_count` и другие. */
  name: string;
  /** Полезная нагрузка, уже разобранная из JSON. */
  data: unknown;
}

/** Что транспорт получает от клиента при подключении. */
export interface TransportContext {
  /** Базовый URL API. */
  baseUrl: string;
  /** Разрешено ли передавать токен этому сервису. */
  authorize: boolean;
  /** Реализация `fetch`. */
  fetch: typeof fetch;
  /**
   * Выполнение обычных HTTP-запросов транспорта через конвейер клиента.
   *
   * Есть только у потока, созданного клиентом: конвейер принадлежит ему.
   */
  request?: RealtimeRequest | undefined;
  /**
   * Общие заголовки клиента: `User-Agent`, `X-Device-Id`, заголовки конфигурации
   * и cookie для указанного адреса.
   */
  baseHeaders: (url: string) => Promise<Headers>;
  /** Текущий токен доступа. */
  getToken: () => Promise<string | null>;
  /** Отмена подключения. */
  signal: AbortSignal;
  /** Сообщает о полученном событии. */
  onEvent: (event: TransportEvent) => void;
  /** Сообщает о разобранном, но некорректном сообщении. Соединение при этом живёт. */
  onParseError: (error: unknown, raw: string) => void;
  /** Вызывается, когда соединение установлено. */
  onOpen: () => void;
}

/** Канал получения исходных событий в реальном времени. */
export interface RealtimeTransport {
  /** Понятное имя для логов и диагностики. */
  readonly name: string;

  /**
   * Держит соединение, пока оно живо.
   *
   * Должен завершиться, когда поток закрылся, и бросить исключение при ошибке.
   * Отмена через `context.signal` должна приводить к `AbortError`.
   */
  connect(context: TransportContext): Promise<void>;
}

/** Ошибка, по которой видно, что сервер отверг авторизацию потока. */
export class UnauthorizedStreamError extends Error {
  constructor() {
    super('Поток событий отверг токен доступа');
    this.name = 'UnauthorizedStreamError';
  }
}
