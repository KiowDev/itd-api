/** Кодирует значение в сегмент JWT — JSON в base64url. */
function encodeSegment(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const binary = String.fromCharCode(...bytes);

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Собирает JWT с заданной полезной нагрузкой.
 *
 * Подпись фиктивная: библиотека её не проверяет и проверить не может — ключа у клиента нет.
 */
export function makeJwt(payload: Record<string, unknown>): string {
  return `${encodeSegment({ alg: 'HS256', typ: 'JWT' })}.${encodeSegment(payload)}.signature`;
}
