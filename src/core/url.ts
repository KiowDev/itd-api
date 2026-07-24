import { ItdConfigError } from './errors.js';

/** Значение параметра запроса. `undefined` и `null` в строку не попадают. */
export type QueryValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly (string | number | boolean)[];

/** Параметры строки запроса. */
export type QueryParams = Record<string, QueryValue>;

/**
 * Собирает строку запроса.
 *
 * Правила:
 * - `undefined` и `null` пропускаются целиком — не нужно чистить объект перед вызовом;
 * - `boolean` превращается в `true` / `false`;
 * - массив повторяет ключ (`ids=1&ids=2`).
 *
 * @returns строка вида `?a=1&b=2` либо пустая строка, если параметров нет
 *
 * @example
 * ```ts
 * buildQuery({ tab: 'popular', limit: 20, cursor: undefined });
 * // '?tab=popular&limit=20'
 * ```
 */
export function buildQuery(params?: QueryParams): string {
  if (!params) return '';

  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;

    if (Array.isArray(value)) {
      for (const item of value) {
        if (item === undefined || item === null) continue;
        search.append(key, String(item));
      }
      continue;
    }

    search.append(key, String(value));
  }

  const query = search.toString();
  return query ? `?${query}` : '';
}

/**
 * Кодирует значение для подстановки в путь.
 *
 * Нужно для сегментов, которые могут содержать что угодно, — прежде всего хэштегов
 * в `/api/hashtags/{tag}/posts`.
 *
 * @throws {ItdConfigError} если значение пустое
 */
export function encodePathSegment(value: string, name = 'параметр пути'): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ItdConfigError(
      `${name} должен быть непустой строкой, получено: ${JSON.stringify(value)}`,
    );
  }
  return encodeURIComponent(value);
}

/**
 * Склеивает базовый URL и путь.
 *
 * Завершающий слэш пути сохраняется: он значим для `/api/notifications/`
 * и `/api/v1/subscription/`, без него сервер отвечает ошибкой.
 *
 * @example
 * ```ts
 * joinUrl('https://xn--d1ah4a.com/', '/api/notifications/');
 * // 'https://xn--d1ah4a.com/api/notifications/'
 * ```
 */
export function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}${suffix}`;
}

/** Приводит базовый URL к каноничному виду и проверяет, что он вообще похож на URL. */
export function normalizeBaseUrl(baseUrl: string): string {
  if (typeof baseUrl !== 'string' || baseUrl.trim() === '') {
    throw new ItdConfigError(
      `baseUrl должен быть непустой строкой с абсолютным URL, получено: ${JSON.stringify(baseUrl)}`,
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new ItdConfigError(
      `baseUrl должен быть абсолютным URL, получено: ${JSON.stringify(baseUrl)}`,
    );
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ItdConfigError(
      `baseUrl должен использовать http или https, получено: ${parsed.protocol}`,
    );
  }

  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new ItdConfigError(
      'baseUrl не должен содержать логин, пароль, query-параметры или fragment',
    );
  }

  return parsed.origin + (parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/$/, ''));
}
