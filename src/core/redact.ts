/** Заголовки, значение которых нельзя писать в лог целиком. */
const SECRET_HEADERS = new Set(['authorization', 'cookie', 'set-cookie', 'x-api-key']);

/** Поля тела запроса, значение которых нельзя писать в лог. */
const SECRET_FIELDS = new Set([
  'password',
  'oldpassword',
  'newpassword',
  'accesstoken',
  'refreshtoken',
  'currentpassword',
  'flowtoken',
  'token',
  'turnstiletoken',
  'otp',
]);

/**
 * Прячет середину секрета, оставляя концы для сопоставления.
 *
 * @example
 * ```ts
 * maskSecret('eyJhbGciOiJIUzI1NiJ9.abc'); // 'eyJh…(24)…abc'
 * ```
 */
export function maskSecret(value: string): string {
  if (value.length <= 8) return '…';
  return `${value.slice(0, 4)}…(${value.length})…${value.slice(-3)}`;
}

/**
 * Готовит заголовки к записи в лог.
 *
 * `Authorization` и `Cookie` маскируются: логи часто уезжают в системы сбора,
 * и токен доступа в них попадать не должен.
 */
export function redactHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};

  headers.forEach((value, name) => {
    if (SECRET_HEADERS.has(name.toLowerCase())) {
      // У Authorization маскируем только сам токен, схему («Bearer») оставляем видимой.
      const spaceAt = value.indexOf(' ');
      result[name] =
        spaceAt > 0
          ? `${value.slice(0, spaceAt)} ${maskSecret(value.slice(spaceAt + 1))}`
          : maskSecret(value);
      return;
    }
    result[name] = value;
  });

  return result;
}

/**
 * Готовит тело запроса к записи в лог: пароли, токены и коды OTP заменяются заглушкой.
 *
 * Обходит вложенные объекты и массивы. `FormData` и бинарные тела не раскрываются вовсе.
 */
export function redactBody(body: unknown): unknown {
  if (body === null || body === undefined) return body;

  if (typeof FormData !== 'undefined' && body instanceof FormData) return '[FormData]';
  if (typeof Blob !== 'undefined' && body instanceof Blob) return '[Blob]';
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return '[binary]';

  if (Array.isArray(body)) return body.map(redactBody);

  if (typeof body === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(body)) {
      result[key] = SECRET_FIELDS.has(key.toLowerCase()) ? '[скрыто]' : redactBody(value);
    }
    return result;
  }

  return body;
}
