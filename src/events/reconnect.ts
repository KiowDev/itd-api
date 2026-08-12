/**
 * Паузы перед попытками переподключения, мс.
 *
 * Значения совпадают с теми, что использует сайт итд.com, — поведение библиотеки
 * не отличается от привычного пользователю.
 */
export const RECONNECT_BACKOFF = Object.freeze([1000, 2000, 4000, 8000, 16000, 30000]);

/** Доля случайного разброса паузы. */
export const RECONNECT_JITTER = 0.3;

/**
 * Сколько раз пытаться переподключиться подряд.
 *
 * После исчерпания поток сообщает `giveup` и ждёт ручного `connect()`.
 */
export const MAX_RECONNECT_ATTEMPTS = 15;

/** Настройки переподключения. */
export interface ReconnectOptions {
  /** Таблица пауз. Последнее значение действует для всех дальнейших попыток. */
  backoff?: readonly number[];
  /** Доля разброса, 0…1. */
  jitter?: number;
  /** Предел числа попыток. */
  maxAttempts?: number;
}

/**
 * Вычисляет паузу перед попыткой переподключения.
 *
 * Разброс нужен, чтобы клиенты, отключившиеся одновременно из-за перезапуска сервера,
 * не вернулись тоже одновременно.
 *
 * @param attempt номер попытки, начиная с нуля
 * @param random источник случайности; подменяется в тестах
 */
export function reconnectDelay(
  attempt: number,
  options: ReconnectOptions = {},
  random: () => number = Math.random,
): number {
  const backoff = options.backoff ?? RECONNECT_BACKOFF;
  const jitter = options.jitter ?? RECONNECT_JITTER;

  const base = backoff[Math.min(attempt, backoff.length - 1)] ?? 30_000;
  const spread = base * jitter * (random() * 2 - 1);

  return Math.max(0, Math.round(base + spread));
}
