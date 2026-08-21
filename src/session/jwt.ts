/**
 * Разбирает строку base64url.
 *
 * `atob` понимает только обычный base64, поэтому алфавит приводится к нему, а недостающее
 * выравнивание добивается. Результат декодируется как UTF-8: в полезной нагрузке токена
 * может оказаться кириллица, и «бинарная» строка из `atob` сломала бы `JSON.parse`.
 */
function decodeBase64Url(segment: string): string {
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');

  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));

  return new TextDecoder().decode(bytes);
}

/** Читает полезную нагрузку JWT без проверки подписи. */
function readTokenPayload(token: string): Record<string, unknown> | undefined {
  try {
    const payload = token.split('.')[1];
    if (!payload) return undefined;

    const parsed: unknown = JSON.parse(decodeBase64Url(payload));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
    return parsed as Record<string, unknown>;
  } catch {
    // Непрозрачный или повреждённый токен допустим: его свойства просто неизвестны.
    return undefined;
  }
}

/** Идентификаторы владельца и сессии, прочитанные из JWT без проверки подписи. */
export interface TokenIdentity {
  subject?: string | undefined;
  sessionId?: string | undefined;
}

/** Локально используемые поля JWT. */
export interface TokenMetadata extends TokenIdentity {
  expiresAt?: number | undefined;
}

/** Читает используемые клиентом поля JWT за один раз. */
export function readTokenMetadata(token: string): TokenMetadata {
  const payload = readTokenPayload(token);
  if (!payload) return {};

  const { sub, sid, exp } = payload;
  const expiresAt = typeof exp === 'number' && Number.isFinite(exp) ? exp * 1000 : undefined;
  return {
    ...(typeof sub === 'string' && sub.length > 0 ? { subject: sub } : {}),
    ...(typeof sid === 'string' && sid.length > 0 ? { sessionId: sid } : {}),
    ...(expiresAt !== undefined && Number.isFinite(expiresAt) ? { expiresAt } : {}),
  };
}

/**
 * Читает `sub` и `sid` из полезной нагрузки JWT.
 *
 * Подпись не проверяется — ключа для проверки у клиента нет. Прочитанные значения служат
 * лишь метками для разделения локального состояния и не дают доступа: его определяет сервер.
 */
export function readTokenIdentity(token: string): TokenIdentity {
  const { subject, sessionId } = readTokenMetadata(token);
  return { ...(subject ? { subject } : {}), ...(sessionId ? { sessionId } : {}) };
}

/**
 * Читает срок действия JWT из claim `exp`.
 *
 * JWT хранит NumericDate в секундах, а остальное ядро использует миллисекунды. Подпись
 * намеренно не проверяется: значение служит только подсказкой для раннего refresh, а
 * окончательное решение о действительности токена всё равно принимает сервер.
 *
 * @returns момент истечения в миллисекундах либо `undefined` для непрозрачного,
 * повреждённого JWT или некорректного `exp`
 */
export function readTokenExpiration(token: string): number | undefined {
  return readTokenMetadata(token).expiresAt;
}

/**
 * Читает `sub` из полезной нагрузки JWT.
 *
 * @returns идентификатор владельца токена; `undefined`, если токен не JWT, повреждён
 * или поля `sub` в нём нет
 */
export function readTokenSubject(token: string): string | undefined {
  return readTokenIdentity(token).subject;
}
