/** Отметка времени без часового пояса: `2026-07-23 23:14:25`, возможно с долями секунды. */
const NAIVE_STAMP = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}(?:\.\d+)?)$/;

/**
 * Приводит отметку времени без часового пояса к ISO-8601, считая её временем UTC.
 *
 * Строку другого вида возвращает нетронутой.
 *
 * @example
 * ```ts
 * utcStampToIso('2026-07-23 23:14:25');  // '2026-07-23T23:14:25Z'
 * utcStampToIso('2026-07-23T23:14:25Z'); // без изменений
 * ```
 */
export function utcStampToIso(value: string): string {
  const match = typeof value === 'string' ? NAIVE_STAMP.exec(value) : null;
  if (!match) return value;

  const iso = `${match[1]}T${match[2]}Z`;
  return Number.isFinite(Date.parse(iso)) ? iso : value;
}
