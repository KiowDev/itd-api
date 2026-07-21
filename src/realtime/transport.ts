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
  /** Реализация `fetch`. */
  fetch: typeof fetch;
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

/**
 * Канал получения событий в реальном времени.
 *
 * Сейчас у платформы один такой канал — поток `text/event-stream`. Абстракция нужна
 * на будущее: политика безопасности сайта уже разрешает `wss://*.xn--d1ah4a.com`,
 * и когда появится WebSocket, достаточно будет добавить ещё одну реализацию этого
 * интерфейса. Переподключение, обновление токена и разбор уведомлений от транспорта
 * не зависят.
 */
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
    super('Поток уведомлений отверг токен доступа');
    this.name = 'UnauthorizedStreamError';
  }
}
