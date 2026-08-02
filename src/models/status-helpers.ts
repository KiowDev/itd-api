import type { ServiceStatus, StatusDay } from './status.js';

const STATUS_WINDOW_DAYS = 90;

/**
 * Разворачивает историю сервиса в массив на 90 суток.
 * Сутки без данных становятся `null`.
 *
 * @returns массив, где индекс — сколько суток назад: `[0]` — сегодня
 *
 * @example
 * ```ts
 * const status = await itd.platform.status();
 * const days = statusDays(status.services[0]);
 *
 * days[0]?.uptime;                              // доступность за сегодня
 * days.filter((day) => day === null).length;    // за сколько суток данных нет
 * ```
 */
export function statusDays(service: ServiceStatus): (StatusDay | null)[] {
  return Array.from(
    { length: STATUS_WINDOW_DAYS },
    (_, index) => service.days[String(index)] ?? null,
  );
}
