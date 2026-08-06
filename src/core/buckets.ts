/**
 * Ёмкость серверных счётчиков частоты, запросов в минуту.
 *
 * Таблица действует до первого ответа бакета; дальше ёмкость берётся из заголовка
 * `x-ratelimit-limit` и заменяет табличную. `default` — счётчик любого пути без
 * собственного правила на сервере.
 */
export const BUCKET_LIMITS = Object.freeze({
  'posts.stats': 180,
  default: 150,
  feed: 90,
  'posts.like': 85,
  'posts.comments': 80,
  hashtags: 50,
  users: 40,
  notifications: 40,
  'files.get': 40,
  auth: 35,
  'auth.refresh': 25,
  search: 25,
  'comments.like': 22,
  'files.upload': 15,
  'files.remove': 15,
  'posts.comment': 14,
  'hashtags.trending': 13,
  'posts.repost': 7,
  'users.follow': 7,
  'verification.status': 6,
  'posts.create': 5,
  'users.updateMe': 3,
  'reports.create': 3,
  'verification.submit': 3,
} as const satisfies Record<string, number>);

/** Имя встроенного бакета. */
export type RateLimitBucket = keyof typeof BUCKET_LIMITS;

/** Счётчик, из которого списывается путь без собственного правила на сервере. */
export const DEFAULT_RATE_LIMIT_BUCKET: RateLimitBucket = 'default';

/** Известно ли библиотеке имя бакета. */
export function isKnownBucket(name: string): name is RateLimitBucket {
  return Object.hasOwn(BUCKET_LIMITS, name);
}

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
