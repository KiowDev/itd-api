/** Реакция на остаток лимита из заголовков ответа. */
export const RateLimitPacing = Object.freeze({
  /** Задержек нет, пока в бакете есть остаток; исчерпанный бакет ждёт `60000 / limit`. */
  React: 'react',
  /** Ровный темп в пределах минутного лимита: задержки идут с первого запроса. */
  Smooth: 'smooth',
  /** Остаток на темп не влияет; остаётся пауза после `429`. */
  Off: 'off',
} as const);
export type RateLimitPacing = (typeof RateLimitPacing)[keyof typeof RateLimitPacing];
