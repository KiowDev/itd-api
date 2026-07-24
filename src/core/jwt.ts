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

/**
 * Читает `sub` из полезной нагрузки JWT.
 *
 * Подпись **не проверяется** и проверена быть не может: ключа у клиента нет. Значение
 * годится как метка «чья это сохранённая сессия» и не годится как основание доверия —
 * решение о доступе принимает сервер.
 *
 * @returns идентификатор владельца токена; `undefined`, если токен не JWT, повреждён
 * или поля `sub` в нём нет
 */
export function readTokenSubject(token: string): string | undefined {
  try {
    const payload = token.split('.')[1];
    if (!payload) return undefined;

    const parsed: unknown = JSON.parse(decodeBase64Url(payload));
    if (typeof parsed !== 'object' || parsed === null) return undefined;

    const subject = (parsed as { sub?: unknown }).sub;
    return typeof subject === 'string' && subject.length > 0 ? subject : undefined;
  } catch {
    // Токен другого формата — не повод падать: поле просто останется пустым.
    return undefined;
  }
}
