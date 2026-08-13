/**
 * `@itd-api/proxy` — HTTP/HTTPS- и SOCKS5-прокси для `itd-api`.
 *
 * Собирает `fetch` и WebSocket-конструктор, направляющие соединения через прокси.
 * Их можно использовать независимо либо разделить один диспетчер через {@link proxyConnection}.
 * Только для Node, Bun и Deno: использует диспетчеры undici и `node:tls`.
 *
 * @example
 * ```ts
 * import { ItdClient } from 'itd-api';
 * import { proxyFetch } from '@itd-api/proxy';
 *
 * const itd = new ItdClient({
 *   fetch: proxyFetch('socks5://127.0.0.1:1080'),
 * });
 * ```
 *
 * @packageDocumentation
 */

import { type Dispatcher, WebSocket as UndiciWebSocket, fetch as undiciFetch } from 'undici';
import { createProxyDispatcher } from './dispatcher.js';

export { createProxyDispatcher } from './dispatcher.js';
export { ProxyError } from './errors.js';
export { type ParsedProxy, type ProxyKind, parseProxy } from './parse.js';

/** Тело запроса `fetch` с непубличным полем undici. */
type WithDispatcher = RequestInit & { dispatcher?: Dispatcher };

/** `fetch`, ходящий через прокси, и управление его пулом соединений. */
export interface ProxyFetch {
  (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response>;
  /** Диспетчер undici, через который идут запросы. */
  readonly dispatcher: Dispatcher;
  /** Закрывает пул соединений, дождавшись завершения текущих запросов. */
  close(): Promise<void>;
}

/** Настройки {@link proxyFetch}. */
export interface ProxyFetchOptions {
  /**
   * Базовая реализация `fetch`. По умолчанию — `fetch` из undici.
   *
   * Обязана понимать опцию `dispatcher`: именно ею подключается прокси. Реализации,
   * которые её не читают, запрос отправят, но **мимо прокси и без всякой ошибки** —
   * в частности глобальный `fetch` Node 18 и 20, см. {@link proxyFetch}.
   */
  fetch?: typeof fetch | undefined;
}

/** Опции конструктора, совместимые с `WebSocketTransport` из `itd-api/events`. */
export interface ProxyWebSocketOptions {
  headers?: Record<string, string> | undefined;
  /** Принимается для совместимости; тайм-аутом установки управляет сам `WebSocketTransport`. */
  handshakeTimeout?: number | undefined;
}

/** Конструктор WebSocket, использующий уже созданный диспетчер прокси. */
export interface ProxyWebSocket {
  new (
    url: string | URL,
    protocols?: string | string[],
    options?: ProxyWebSocketOptions,
  ): InstanceType<typeof UndiciWebSocket>;
  /** Диспетчер, общий для всех экземпляров этого конструктора. */
  readonly dispatcher: Dispatcher;
  /** Закрывает его пул соединений. Открытые WebSocket следует закрыть до этого вызова. */
  close(): Promise<void>;
}

/** Общий HTTP- и WebSocket-транспорт через один пул соединений прокси. */
export interface ProxyConnection {
  readonly dispatcher: Dispatcher;
  readonly fetch: typeof fetch;
  readonly webSocket: ProxyWebSocket;
  /** Закрывает общий пул. Сначала завершите запросы и открытые WebSocket-каналы. */
  close(): Promise<void>;
}

/**
 * Собирает `fetch`, все запросы которого идут через прокси.
 *
 * Диспетчер создаётся один раз и переиспользуется. Закройте возвращённый `fetch`
 * методом `close()`, когда он больше не нужен.
 *
 * @param proxy адрес прокси: `http://…`, `https://…`, `socks5://…` (можно с `user:pass@`)
 * @throws {ProxyError} если адрес не разбирается или схема не поддерживается
 *
 * @example
 * ```ts
 * const fetch = proxyFetch('http://user:pass@proxy:8080');
 * const itd = new ItdClient({ fetch });
 *
 * // …работа…
 * await itd.close();
 * await fetch.close(); // закрывает пул соединений
 * ```
 */
export function proxyFetch(proxy: string | URL, options: ProxyFetchOptions = {}): ProxyFetch {
  const dispatcher = createProxyDispatcher(proxy);

  return createFetch(dispatcher, options.fetch);
}

function createFetch(dispatcher: Dispatcher, base?: typeof fetch): ProxyFetch {
  // Именно undici, а не globalThis.fetch: опция `dispatcher` появилась в undici 6.3,
  // а Node 18 и 20 несут внутри undici 5, где она молча отбрасывается — запрос уходит
  // напрямую, с настоящим адресом и без единой ошибки. Пакет тянет undici ради
  // ProxyAgent, так что своей версии тут не занимать.
  const baseFetch = base ?? (undiciFetch as unknown as typeof fetch);

  const proxied = (input: Parameters<typeof fetch>[0], init?: RequestInit) =>
    baseFetch(input, { ...init, dispatcher } as WithDispatcher);

  return Object.assign(proxied, {
    dispatcher,
    close: () => dispatcher.close(),
  });
}

/**
 * Создаёт совместимый с `WebSocketTransport` конструктор, направляющий подключения через прокси.
 *
 * Использует WebSocket из уже установленного `undici` и тот же тип диспетчера, что
 * {@link proxyFetch}; дополнительная зависимость времени выполнения не требуется.
 *
 * @example
 * ```ts
 * import { WebSocketTransport } from 'itd-api/events';
 * import { proxyWebSocket } from '@itd-api/proxy';
 *
 * const webSocket = proxyWebSocket('socks5://127.0.0.1:1080');
 * const transport = new WebSocketTransport({ webSocketImpl: webSocket });
 * // ...после закрытия каналов
 * await webSocket.close();
 * ```
 */
export function proxyWebSocket(proxy: string | URL): ProxyWebSocket {
  const dispatcher = createProxyDispatcher(proxy);

  return createWebSocket(dispatcher);
}

function createWebSocket(dispatcher: Dispatcher): ProxyWebSocket {
  class WebSocketViaProxy extends UndiciWebSocket {
    constructor(
      url: string | URL,
      protocols: string | string[] = [],
      options: ProxyWebSocketOptions = {},
    ) {
      super(url, {
        protocols,
        dispatcher,
        ...(options.headers ? { headers: options.headers } : {}),
      });
    }

    static readonly dispatcher = dispatcher;
    static close(): Promise<void> {
      return dispatcher.close();
    }
  }

  return WebSocketViaProxy;
}

/**
 * Создаёт `fetch` и WebSocket-конструктор через один диспетчер прокси.
 *
 * Это предпочтительный вариант для клиента, которому одновременно нужны REST/SSE и
 * WebSocket: отдельные пулы и дополнительные зависимости не создаются.
 */
export function proxyConnection(
  proxy: string | URL,
  options: ProxyFetchOptions = {},
): ProxyConnection {
  const dispatcher = createProxyDispatcher(proxy);
  const fetch = createFetch(dispatcher, options.fetch);
  const webSocket = createWebSocket(dispatcher);

  return {
    dispatcher,
    fetch,
    webSocket,
    close: () => dispatcher.close(),
  };
}
