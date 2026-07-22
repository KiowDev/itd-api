import { ItdConfigError } from './errors.js';

/**
 * Как библиотека обращается с cookie.
 *
 * - `browser` — cookie ведёт браузер, запросы уходят с `credentials: 'include'`;
 * - `server` — cookie ведёт встроенный jar, заголовок `Cookie` подставляется вручную;
 * - `auto` — определяется по среде исполнения (значение по умолчанию).
 */
export const RuntimeMode = Object.freeze({
  /** Определяется по среде исполнения. Значение по умолчанию. */
  Auto: 'auto',
  /** Cookie ведёт браузер, запросы уходят с `credentials: 'include'`. */
  Browser: 'browser',
  /** Cookie ведёт встроенный jar, заголовок `Cookie` подставляется вручную. */
  Server: 'server',
} as const);
export type RuntimeMode = (typeof RuntimeMode)[keyof typeof RuntimeMode];

/** Распознанная среда исполнения. */
export const DetectedRuntime = Object.freeze({
  Browser: 'browser',
  /** Есть `window`, но нет `document`; cookie ведёт нативный сетевой слой. */
  ReactNative: 'react-native',
  Server: 'server',
} as const);
export type DetectedRuntime = (typeof DetectedRuntime)[keyof typeof DetectedRuntime];

/**
 * Определяет среду исполнения.
 *
 * React Native выделен отдельно намеренно: там есть `window`, но нет `document`, а cookie
 * хранит нативный сетевой слой (`NSHTTPCookieStorage` / `OkHttp`). Свой jar в этой среде
 * привёл бы к отправке cookie дважды.
 */
export function detectRuntime(): DetectedRuntime {
  const nav = (globalThis as { navigator?: { product?: string } }).navigator;
  if (nav?.product === 'ReactNative') return DetectedRuntime.ReactNative;

  if (typeof document !== 'undefined') return DetectedRuntime.Browser;

  return DetectedRuntime.Server;
}

/**
 * Нужно ли вести собственный cookie-jar.
 *
 * Только в серверных средах: в браузере `Set-Cookie` из JS не читается и не нужен,
 * в React Native cookie ведёт нативный слой.
 */
export function shouldUseCookieJar(mode: RuntimeMode): boolean {
  if (mode === RuntimeMode.Browser) return false;
  if (mode === RuntimeMode.Server) return true;
  return detectRuntime() === DetectedRuntime.Server;
}

/**
 * Нужно ли отправлять запросы с `credentials: 'include'`.
 *
 * Только в браузере: именно так refresh-cookie попадает в запрос `POST /api/v1/auth/refresh`.
 * Требует настроенного CORS на стороне итд.com — если его нет, укажите свой прокси в `baseUrl`.
 */
export function shouldSendCredentials(mode: RuntimeMode): boolean {
  if (mode === RuntimeMode.Browser) return true;
  if (mode === RuntimeMode.Server) return false;
  return detectRuntime() === DetectedRuntime.Browser;
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

/**
 * Проверки бинарных типов, безопасные в любой среде.
 *
 * Обычный `instanceof` здесь недостаточен: конструктора может не быть вовсе, и тогда
 * проверка падает с `ReferenceError`, а не возвращает `false`. `Blob` есть в Node с 18.0,
 * но `File` стал глобальным только в Node 20 — при заявленной поддержке Node 18 голый
 * `instanceof File` ронял бы любую загрузку.
 */
export function isBlob(value: unknown): value is Blob {
  return typeof Blob !== 'undefined' && value instanceof Blob;
}

/** @see {@link isBlob} */
export function isFile(value: unknown): value is File {
  return typeof File !== 'undefined' && value instanceof File;
}

/** Доступно ли потоковое чтение тела ответа — от этого зависит, сработает ли SSE. */
export function supportsStreamingBody(): boolean {
  return typeof ReadableStream !== 'undefined' && typeof TextDecoder !== 'undefined';
}

/**
 * Создаёт идентификатор устройства для заголовка `X-Device-Id` — UUID v4.
 *
 * `crypto.randomUUID` есть в Node 19+, браузерах и Deno, но отсутствует в Node 18 вне
 * защищённого контекста, поэтому предусмотрен запасной путь.
 */
export function createDeviceId(): string {
  const webCrypto = (globalThis as { crypto?: Crypto }).crypto;

  if (typeof webCrypto?.randomUUID === 'function') return webCrypto.randomUUID();

  // Форма UUID v4 собирается вручную: серверу важна стабильность значения, а не его энтропия.
  const bytes = new Uint8Array(16);
  if (typeof webCrypto?.getRandomValues === 'function') webCrypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);

  // biome-ignore lint/style/noNonNullAssertion: длина массива фиксирована выше
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  // biome-ignore lint/style/noNonNullAssertion: длина массива фиксирована выше
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

/** Есть ли в среде `localStorage`. Проверка безопасна: доступ к нему может бросать. */
export function hasLocalStorage(): boolean {
  try {
    return typeof globalThis.localStorage !== 'undefined' && globalThis.localStorage !== null;
  } catch {
    return false;
  }
}
