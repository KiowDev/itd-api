import type { RateLimitBucketOverride } from '../core/options.js';

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
  shop: 150,
  'shop.delivery.cities': 60,
  'shop.delivery.calculate': 45,
  'shop.delivery.points': 30,
  'shop.consents.record': 15,
  'shop.orders.pay': 13,
  'shop.orders.verifyAccessCode': 13,
  'shop.orders.create': 12,
  'shop.orders.requestAccessCode': 4,
} as const satisfies Record<string, number>);

/** Имя встроенного бакета. */
export type RateLimitBucket = keyof typeof BUCKET_LIMITS;

/** Счётчик, из которого списывается путь без собственного правила на сервере. */
export const DEFAULT_RATE_LIMIT_BUCKET: RateLimitBucket = 'default';

/** Известно ли библиотеке имя бакета. */
export function isKnownBucket(name: string): name is RateLimitBucket {
  return Object.hasOwn(BUCKET_LIMITS, name);
}

/**
 * Встроенные поправки бакетов.
 *
 * Таймаут загрузки файла — пять минут против обычных тридцати секунд, поэтому её
 * одновременность ограничена одним запросом.
 */
export const DEFAULT_BUCKET_OVERRIDES: Readonly<Record<string, RateLimitBucketOverride>> =
  Object.freeze({
    'files.upload': Object.freeze({ concurrency: 1 }),
  });
