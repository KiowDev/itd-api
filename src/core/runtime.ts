import { ItdConfigError } from './errors.js';

/**
 * Как библиотека обращается с cookie.
 *
 * - `browser` — cookie ведёт браузер, запросы уходят с `credentials: 'include'`;
 * - `server` — cookie ведёт встроенный jar, заголовок `Cookie` подставляется вручную;
 * - `auto` — определяется по среде исполнения (значение по умолчанию).
 */
export type RuntimeMode = 'auto' | 'browser' | 'server';

/** Распознанная среда исполнения. */
export type DetectedRuntime = 'browser' | 'react-native' | 'server';

/**
 * Определяет среду исполнения.
 *
 * React Native выделен отдельно намеренно: там есть `window`, но нет `document`, а cookie
 * хранит нативный сетевой слой (`NSHTTPCookieStorage` / `OkHttp`). Свой jar в этой среде
 * привёл бы к отправке cookie дважды.
 */
export function detectRuntime(): DetectedRuntime {
  const nav = (globalThis as { navigator?: { product?: string } }).navigator;
  if (nav?.product === 'ReactNative') return 'react-native';

  if (typeof document !== 'undefined') return 'browser';

  return 'server';
}

/**
 * Нужно ли вести собственный cookie-jar.
 *
 * Только в серверных средах: в браузере `Set-Cookie` из JS не читается и не нужен,
 * в React Native cookie ведёт нативный слой.
 */
export function shouldUseCookieJar(mode: RuntimeMode): boolean {
  if (mode === 'browser') return false;
  if (mode === 'server') return true;
  return detectRuntime() === 'server';
}

/**
 * Нужно ли отправлять запросы с `credentials: 'include'`.
 *
 * Только в браузере: именно так refresh-cookie попадает в запрос `POST /api/v1/auth/refresh`.
 * Требует настроенного CORS на стороне итд.com — если его нет, укажите свой прокси в `baseUrl`.
 */
export function shouldSendCredentials(mode: RuntimeMode): boolean {
  if (mode === 'browser') return true;
  if (mode === 'server') return false;
  return detectRuntime() === 'browser';
}

/**
 * Возвращает реализацию `fetch`.
 *
 * @param custom реализация из конфигурации клиента, если пользователь её передал
 * @throws {ItdConfigError} если `fetch` недоступен — например, на Node ниже 18
 */
export function resolveFetch(custom?: typeof fetch): typeof fetch {
  if (custom) return custom;

  if (typeof globalThis.fetch === 'function') {
    // Привязка к globalThis обязательна: в некоторых средах несвязанный fetch бросает
    // «Illegal invocation».
    return globalThis.fetch.bind(globalThis);
  }

  throw new ItdConfigError(
    'В этой среде нет глобального fetch. Обновитесь до Node 18+ либо передайте свою ' +
      'реализацию через опцию fetch.',
  );
}

/** Доступно ли потоковое чтение тела ответа — от этого зависит, сработает ли SSE. */
export function supportsStreamingBody(): boolean {
  return typeof ReadableStream !== 'undefined' && typeof TextDecoder !== 'undefined';
}

/** Есть ли в среде `localStorage`. Проверка безопасна: доступ к нему может бросать. */
export function hasLocalStorage(): boolean {
  try {
    return typeof globalThis.localStorage !== 'undefined' && globalThis.localStorage !== null;
  } catch {
    return false;
  }
}
