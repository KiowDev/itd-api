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

/** Идентификаторы владельца и сессии, прочитанные из JWT без проверки подписи. */
export interface TokenIdentity {
  subject?: string | undefined;
  sessionId?: string | undefined;
}

/**
 * Читает `sub` и `sid` из полезной нагрузки JWT.
 *
 * Подпись не проверяется — ключа для проверки у клиента нет. Прочитанные значения служат
 * лишь метками для разделения локального состояния и не дают доступа: его определяет сервер.
 */
export function readTokenIdentity(token: string): TokenIdentity {
  try {
    const payload = token.split('.')[1];
    if (!payload) return {};

    const parsed: unknown = JSON.parse(decodeBase64Url(payload));
    if (typeof parsed !== 'object' || parsed === null) return {};

    const { sub, sid } = parsed as { sub?: unknown; sid?: unknown };
    return {
      ...(typeof sub === 'string' && sub.length > 0 ? { subject: sub } : {}),
      ...(typeof sid === 'string' && sid.length > 0 ? { sessionId: sid } : {}),
    };
  } catch {
    // Токен другого формата — не повод падать: поля просто останутся пустыми.
    return {};
  }
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
