/**
 * `itd-api-proxy` — HTTP/HTTPS- и SOCKS5-прокси для `itd-api`.
 *
 * Собирает `fetch`, направляющий запросы через прокси; передаётся клиенту опцией `fetch`.
 * Только для Node, Bun и Deno: использует диспетчеры undici и `node:tls`.
 *
 * @example
 * ```ts
 * import { ItdClient } from 'itd-api';
 * import { proxyFetch } from 'itd-api-proxy';
 *
 * const itd = new ItdClient({
 *   fetch: proxyFetch('socks5://127.0.0.1:1080'),
 * });
 * ```
 *
 * @packageDocumentation
 */

import { type Dispatcher, fetch as undiciFetch } from 'undici';
import { createProxyDispatcher } from './dispatcher.js';

export { createProxyDispatcher } from './dispatcher.js';
export { ProxyError } from './errors.js';
export { type ParsedProxy, type ProxyKind, parseProxy } from './parse.js';

/** Тело запроса `fetch` с непубличным полем undici. */
type WithDispatcher = RequestInit & { dispatcher?: Dispatcher };

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

/**
 * Собирает `fetch`, все запросы которого идут через прокси.
 *
 * Диспетчер создаётся один раз и переиспользуется (пул соединений к прокси).
 *
 * @param proxy адрес прокси: `http://…`, `https://…`, `socks5://…` (можно с `user:pass@`)
 * @throws {ProxyError} если адрес не разбирается или схема не поддерживается
 *
 * @example
 * ```ts
 * const itd = new ItdClient({ fetch: proxyFetch('http://user:pass@proxy:8080') });
 * ```
 */
export function proxyFetch(proxy: string | URL, options: ProxyFetchOptions = {}): typeof fetch {
  const dispatcher = createProxyDispatcher(proxy);

  // Именно undici, а не globalThis.fetch: опция `dispatcher` появилась в undici 6.3,
  // а Node 18 и 20 несут внутри undici 5, где она молча отбрасывается — запрос уходит
  // напрямую, с настоящим адресом и без единой ошибки. Пакет тянет undici ради
  // ProxyAgent, так что своей версии тут не занимать.
  const baseFetch = options.fetch ?? (undiciFetch as unknown as typeof fetch);

  return (input: Parameters<typeof fetch>[0], init?: RequestInit) =>
    baseFetch(input, { ...init, dispatcher } as WithDispatcher);
}
