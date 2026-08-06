/** HTTP-метод встроенной операции. */
export type OperationMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Семантическая безопасность автоматического повтора операции. */
export const RetrySafety = Object.freeze({
  /** Автоматический повтор не создаёт неприемлемого эффекта; обычно это чтение. */
  Safe: 'safe',
  /** Повтор операции приводит к тому же состоянию, что и один вызов. */
  Idempotent: 'idempotent',
  /** Повтор может создать ещё один побочный эффект. */
  Unsafe: 'unsafe',
} as const);
export type RetrySafety = (typeof RetrySafety)[keyof typeof RetrySafety];

/**
 * Ёмкость серверных счётчиков частоты, запросов в минуту.
 *
 * Значения действуют до первого ответа бакета; дальше ёмкость приходит
 * в `x-ratelimit-limit` и заменяет табличную. `default` — счётчик любого пути
 * без собственного правила на сервере.
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

/** Имя встроенного серверного счётчика частоты. */
export type RateLimitBucket = keyof typeof BUCKET_LIMITS;

/** Счётчик, из которого списывается путь без собственного правила на сервере. */
export const DEFAULT_RATE_LIMIT_BUCKET: RateLimitBucket = 'default';

/** Минимальное стабильное описание операции, доступное core и плагинам. */
export interface OperationDefinition {
  readonly method: OperationMethod;
  readonly retrySafety: RetrySafety;
  /**
   * Серверный счётчик частоты. Опущено — операция списывает из `default`.
   *
   * Счётчик определяется парой «путь + метод»: `GET /api/users/me` — 40 запросов
   * в минуту, `PUT` того же пути — 3, `DELETE` — 150.
   */
  readonly bucket?: RateLimitBucket;
}

function freezeOperations<const T extends Record<string, OperationDefinition>>(
  operations: T,
): Readonly<{ readonly [K in keyof T]: Readonly<T[K]> }> {
  for (const definition of Object.values(operations)) Object.freeze(definition);
  return Object.freeze(operations);
}

/**
 * Каталог встроенных операций.
 *
 * ID описывает смысл вызова и не меняется при переносе HTTP-пути. Method и retrySafety
 * хранятся здесь, чтобы resources, retry и плагины не вели независимые таблицы операций.
 */
export const OPERATIONS = freezeOperations({
  'auth.check': { method: 'GET', retrySafety: RetrySafety.Safe },
  'auth.signUp': { method: 'POST', retrySafety: RetrySafety.Unsafe, bucket: 'auth' },
  'auth.signIn': { method: 'POST', retrySafety: RetrySafety.Safe, bucket: 'auth' },
  'auth.verifyOtp': { method: 'POST', retrySafety: RetrySafety.Unsafe, bucket: 'auth' },
  'auth.resendOtp': { method: 'POST', retrySafety: RetrySafety.Unsafe, bucket: 'auth' },
  'auth.refresh': { method: 'POST', retrySafety: RetrySafety.Unsafe, bucket: 'auth.refresh' },
  'auth.logout': { method: 'POST', retrySafety: RetrySafety.Unsafe, bucket: 'auth' },
  'auth.forgotPassword': { method: 'POST', retrySafety: RetrySafety.Unsafe, bucket: 'auth' },
  'auth.resetPassword': { method: 'POST', retrySafety: RetrySafety.Unsafe, bucket: 'auth' },
  'auth.changePassword': { method: 'POST', retrySafety: RetrySafety.Unsafe, bucket: 'auth' },
  'auth.sessions': { method: 'GET', retrySafety: RetrySafety.Safe, bucket: 'auth' },
  'auth.revokeSession': { method: 'DELETE', retrySafety: RetrySafety.Unsafe, bucket: 'auth' },
  'auth.revokeOtherSessions': {
    method: 'DELETE',
    retrySafety: RetrySafety.Unsafe,
    bucket: 'auth',
  },

  'users.me': { method: 'GET', retrySafety: RetrySafety.Safe, bucket: 'users' },
  'users.updateMe': {
    method: 'PUT',
    retrySafety: RetrySafety.Idempotent,
    bucket: 'users.updateMe',
  },
  'users.deactivate': { method: 'DELETE', retrySafety: RetrySafety.Unsafe },
  'users.restore': { method: 'POST', retrySafety: RetrySafety.Unsafe },
  'users.createProfile': { method: 'POST', retrySafety: RetrySafety.Unsafe },
  'users.get': { method: 'GET', retrySafety: RetrySafety.Safe, bucket: 'users' },
  'users.checkUsername': { method: 'GET', retrySafety: RetrySafety.Safe, bucket: 'users' },
  'users.search': { method: 'GET', retrySafety: RetrySafety.Safe, bucket: 'users' },
  'users.whoToFollow': { method: 'GET', retrySafety: RetrySafety.Safe, bucket: 'users' },
  'users.topClans': { method: 'GET', retrySafety: RetrySafety.Safe, bucket: 'users' },
  'users.follow': { method: 'POST', retrySafety: RetrySafety.Unsafe, bucket: 'users.follow' },
  'users.unfollow': { method: 'DELETE', retrySafety: RetrySafety.Unsafe, bucket: 'users.follow' },
  'users.followers': { method: 'GET', retrySafety: RetrySafety.Safe, bucket: 'users' },
  'users.following': { method: 'GET', retrySafety: RetrySafety.Safe, bucket: 'users' },
  'users.followStatus': { method: 'POST', retrySafety: RetrySafety.Safe },
  'users.block': { method: 'POST', retrySafety: RetrySafety.Unsafe },
  'users.unblock': { method: 'DELETE', retrySafety: RetrySafety.Unsafe },
  'users.blocked': { method: 'GET', retrySafety: RetrySafety.Safe, bucket: 'users' },
  'users.getPrivacy': { method: 'GET', retrySafety: RetrySafety.Safe, bucket: 'users' },
  'users.updatePrivacy': { method: 'PUT', retrySafety: RetrySafety.Idempotent },
  'users.pins': { method: 'GET', retrySafety: RetrySafety.Safe, bucket: 'users' },
  'users.setPin': { method: 'PUT', retrySafety: RetrySafety.Idempotent },
  'users.removePin': { method: 'DELETE', retrySafety: RetrySafety.Unsafe },

  'posts.list': { method: 'GET', retrySafety: RetrySafety.Safe, bucket: 'feed' },
  'posts.create': { method: 'POST', retrySafety: RetrySafety.Unsafe, bucket: 'posts.create' },
  'posts.get': { method: 'GET', retrySafety: RetrySafety.Safe },
  'posts.update': { method: 'PUT', retrySafety: RetrySafety.Idempotent },
  'posts.remove': { method: 'DELETE', retrySafety: RetrySafety.Unsafe },
  'posts.restore': { method: 'POST', retrySafety: RetrySafety.Unsafe },
  'posts.like': { method: 'POST', retrySafety: RetrySafety.Unsafe, bucket: 'posts.like' },
  'posts.unlike': { method: 'DELETE', retrySafety: RetrySafety.Unsafe, bucket: 'posts.like' },
  'posts.repost': { method: 'POST', retrySafety: RetrySafety.Unsafe, bucket: 'posts.repost' },
  'posts.unrepost': { method: 'DELETE', retrySafety: RetrySafety.Unsafe, bucket: 'posts.repost' },
  'posts.pin': { method: 'POST', retrySafety: RetrySafety.Unsafe },
  'posts.unpin': { method: 'DELETE', retrySafety: RetrySafety.Unsafe },
  'posts.vote': { method: 'POST', retrySafety: RetrySafety.Unsafe },
  'posts.stats': { method: 'POST', retrySafety: RetrySafety.Safe, bucket: 'posts.stats' },
  'posts.byUser': { method: 'GET', retrySafety: RetrySafety.Safe },
  'posts.likedByUser': { method: 'GET', retrySafety: RetrySafety.Safe },
  'posts.comments': { method: 'GET', retrySafety: RetrySafety.Safe, bucket: 'posts.comments' },
  'posts.comment': { method: 'POST', retrySafety: RetrySafety.Unsafe, bucket: 'posts.comment' },

  'comments.replies': { method: 'GET', retrySafety: RetrySafety.Safe },
  'comments.reply': { method: 'POST', retrySafety: RetrySafety.Unsafe },
  'comments.update': { method: 'PATCH', retrySafety: RetrySafety.Idempotent },
  'comments.remove': { method: 'DELETE', retrySafety: RetrySafety.Unsafe },
  'comments.restore': { method: 'POST', retrySafety: RetrySafety.Unsafe },
  'comments.like': { method: 'POST', retrySafety: RetrySafety.Unsafe, bucket: 'comments.like' },
  'comments.unlike': {
    method: 'DELETE',
    retrySafety: RetrySafety.Unsafe,
    bucket: 'comments.like',
  },

  'files.upload': { method: 'POST', retrySafety: RetrySafety.Unsafe, bucket: 'files.upload' },
  'files.get': { method: 'GET', retrySafety: RetrySafety.Safe, bucket: 'files.get' },
  'files.remove': { method: 'DELETE', retrySafety: RetrySafety.Unsafe, bucket: 'files.remove' },

  'notifications.list': { method: 'GET', retrySafety: RetrySafety.Safe, bucket: 'notifications' },
  'notifications.count': { method: 'GET', retrySafety: RetrySafety.Safe, bucket: 'notifications' },
  'notifications.markRead': { method: 'POST', retrySafety: RetrySafety.Idempotent },
  'notifications.markReadBatch': { method: 'POST', retrySafety: RetrySafety.Idempotent },
  'notifications.markAllRead': { method: 'POST', retrySafety: RetrySafety.Idempotent },
  'notifications.getSettings': {
    method: 'GET',
    retrySafety: RetrySafety.Safe,
    bucket: 'notifications',
  },
  'notifications.updateSettings': { method: 'PUT', retrySafety: RetrySafety.Idempotent },

  // Опрос уведомлений идёт по тем же двум маршрутам, что notifications.list и .count,
  // и делит с ними один серверный счётчик: при интервале 2 секунды фоновый поток
  // съедает три четверти бакета.
  'realtime.poll.updates': {
    method: 'GET',
    retrySafety: RetrySafety.Safe,
    bucket: 'notifications',
  },
  'realtime.poll.unread': { method: 'GET', retrySafety: RetrySafety.Safe, bucket: 'notifications' },

  'hashtags.search': { method: 'GET', retrySafety: RetrySafety.Safe, bucket: 'hashtags' },
  'hashtags.trending': {
    method: 'GET',
    retrySafety: RetrySafety.Safe,
    bucket: 'hashtags.trending',
  },
  'hashtags.posts': { method: 'GET', retrySafety: RetrySafety.Safe, bucket: 'hashtags' },
  'search.all': { method: 'GET', retrySafety: RetrySafety.Safe, bucket: 'search' },
  'reports.create': { method: 'POST', retrySafety: RetrySafety.Unsafe, bucket: 'reports.create' },

  'subscription.status': { method: 'GET', retrySafety: RetrySafety.Safe },
  'subscription.pay': { method: 'POST', retrySafety: RetrySafety.Unsafe },
  'subscription.setAutoRenewal': { method: 'POST', retrySafety: RetrySafety.Idempotent },
  'subscription.bindCard': { method: 'POST', retrySafety: RetrySafety.Unsafe },
  'subscription.methods': { method: 'GET', retrySafety: RetrySafety.Safe },
  'subscription.setDefaultMethod': { method: 'POST', retrySafety: RetrySafety.Idempotent },
  'subscription.removeMethod': { method: 'DELETE', retrySafety: RetrySafety.Unsafe },

  'verification.status': {
    method: 'GET',
    retrySafety: RetrySafety.Safe,
    bucket: 'verification.status',
  },
  'verification.submit': {
    method: 'POST',
    retrySafety: RetrySafety.Unsafe,
    bucket: 'verification.submit',
  },

  'platform.version': { method: 'GET', retrySafety: RetrySafety.Safe },
  'platform.changelog': { method: 'GET', retrySafety: RetrySafety.Safe },
  'platform.announcements': { method: 'GET', retrySafety: RetrySafety.Safe },
  'platform.portal': { method: 'GET', retrySafety: RetrySafety.Safe },
  'platform.status': { method: 'GET', retrySafety: RetrySafety.Safe },

  'telemetry.dwell': { method: 'POST', retrySafety: RetrySafety.Unsafe },
  'telemetry.interaction': { method: 'POST', retrySafety: RetrySafety.Unsafe },
} as const satisfies Record<string, OperationDefinition>);

/** Стабильный ID встроенной операции. */
export type BuiltInOperationId = keyof typeof OPERATIONS;

/** Пользовательская семантическая операция низкоуровневого запроса. */
export type CustomOperationId = `custom:${string}`;

/** ID любого запроса, видимый transformers и hooks. */
export type OperationId = BuiltInOperationId | CustomOperationId | 'raw';

const BUILT_IN_IDS: ReadonlySet<string> = new Set(Object.keys(OPERATIONS));

/** Проверяет принадлежность ID встроенному каталогу. */
export function isBuiltInOperationId(value: string): value is BuiltInOperationId {
  return BUILT_IN_IDS.has(value);
}

/** HTTP-метод встроенной операции. */
export function operationMethod(id: BuiltInOperationId): OperationMethod {
  return OPERATIONS[id].method;
}

/** Политика автоматического повтора встроенной операции. */
export function operationRetrySafety(id: BuiltInOperationId): RetrySafety {
  return OPERATIONS[id].retrySafety;
}

/**
 * Серверный счётчик частоты операции.
 *
 * `raw` и `custom:*` попадают в `default`; назвать бакет явно позволяет
 * `rateLimitBucket` у запроса.
 */
export function operationBucket(id: OperationId): RateLimitBucket {
  if (!isBuiltInOperationId(id)) return DEFAULT_RATE_LIMIT_BUCKET;
  // Литеральный тип каталога не сохраняет необязательное поле у операций без бакета.
  const definition: OperationDefinition = OPERATIONS[id];
  return definition.bucket ?? DEFAULT_RATE_LIMIT_BUCKET;
}
