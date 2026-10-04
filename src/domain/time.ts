import type { IsoDate } from '../models/common.js';

/**
 * Отметка времени PostgreSQL: `2026-07-23 23:14:25`, возможно с долями секунды и смещением
 * пояса (`+03`, `+05:30`).
 */
const PG_STAMP = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(\.\d+)?(?:([+-]\d{2})(?::?(\d{2}))?)?$/;

/**
 * Приводит отметку времени PostgreSQL к ISO-8601 в UTC.
 *
 * Отметку без пояса считает временем UTC и сохраняет её доли секунды. Отметку со смещением
 * переводит в UTC с точностью до миллисекунд. Строку другого вида возвращает нетронутой.
 *
 * @example
 * ```ts
 * utcStampToIso('2026-07-23 23:14:25');            // '2026-07-23T23:14:25Z'
 * utcStampToIso('2026-10-04 22:32:04.381097+03');  // '2026-10-04T19:32:04.381Z'
 * utcStampToIso('2026-07-23T23:14:25Z');           // без изменений
 * ```
 */
export function utcStampToIso(value: string): string {
  const match = typeof value === 'string' ? PG_STAMP.exec(value) : null;
  if (!match) return value;
  const [, date, time, fraction = '', offsetHours, offsetMinutes = '00'] = match;

  if (offsetHours === undefined) {
    const iso = `${date}T${time}${fraction}Z`;
    return Number.isFinite(Date.parse(iso)) ? iso : value;
  }

  const millis = fraction ? `.${fraction.slice(1, 4).padEnd(3, '0')}` : '';
  const parsed = Date.parse(`${date}T${time}${millis}${offsetHours}:${offsetMinutes}`);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : value;
}

/**
 * Разбирает дату API в объект `Date`.
 *
 * @returns `null`, если строки нет или она не разбирается
 *
 * @example
 * ```ts
 * const created = toDate(post.createdAt);
 * ```
 */
export function toDate(value: IsoDate | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}
