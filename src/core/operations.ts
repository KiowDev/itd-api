/** HTTP-метод встроенной операции. */
export type OperationMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Семантическая безопасность автоматического повтора операции. */
export const RetrySafety = Object.freeze({
  /** Операция только читает состояние и может быть повторена. */
  Safe: 'safe',
  /** Повтор операции приводит к тому же состоянию, что и один вызов. */
  Idempotent: 'idempotent',
  /** Повтор может создать ещё один побочный эффект. */
  Unsafe: 'unsafe',
} as const);
export type RetrySafety = (typeof RetrySafety)[keyof typeof RetrySafety];

/** Минимальное стабильное описание операции, доступное core и плагинам. */
export interface OperationDefinition {
  readonly method: OperationMethod;
  readonly retrySafety: RetrySafety;
}

/**
 * Каталог встроенных операций.
 *
 * ID описывает смысл вызова и не меняется при переносе HTTP-пути. Method и retrySafety
 * хранятся здесь, чтобы resources, retry и плагины не вели независимые таблицы операций.
 */
export const OPERATIONS = Object.freeze({
  'auth.check': { method: 'GET', retrySafety: RetrySafety.Safe },
  'auth.signUp': { method: 'POST', retrySafety: RetrySafety.Unsafe },
  'auth.signIn': { method: 'POST', retrySafety: RetrySafety.Unsafe },
  'auth.verifyOtp': { method: 'POST', retrySafety: RetrySafety.Unsafe },
  'auth.resendOtp': { method: 'POST', retrySafety: RetrySafety.Unsafe },
  'auth.refresh': { method: 'POST', retrySafety: RetrySafety.Unsafe },
  'auth.logout': { method: 'POST', retrySafety: RetrySafety.Unsafe },
  'auth.forgotPassword': { method: 'POST', retrySafety: RetrySafety.Unsafe },
  'auth.resetPassword': { method: 'POST', retrySafety: RetrySafety.Unsafe },
  'auth.changePassword': { method: 'POST', retrySafety: RetrySafety.Unsafe },
  'auth.sessions': { method: 'GET', retrySafety: RetrySafety.Safe },
  'auth.revokeSession': { method: 'DELETE', retrySafety: RetrySafety.Unsafe },
  'auth.revokeOtherSessions': { method: 'DELETE', retrySafety: RetrySafety.Unsafe },

  'users.me': { method: 'GET', retrySafety: RetrySafety.Safe },
  'users.updateMe': { method: 'PUT', retrySafety: RetrySafety.Idempotent },
  'users.deactivate': { method: 'DELETE', retrySafety: RetrySafety.Unsafe },
  'users.restore': { method: 'POST', retrySafety: RetrySafety.Unsafe },
  'users.createProfile': { method: 'POST', retrySafety: RetrySafety.Unsafe },
  'users.get': { method: 'GET', retrySafety: RetrySafety.Safe },
  'users.checkUsername': { method: 'GET', retrySafety: RetrySafety.Safe },
  'users.search': { method: 'GET', retrySafety: RetrySafety.Safe },
  'users.whoToFollow': { method: 'GET', retrySafety: RetrySafety.Safe },
  'users.topClans': { method: 'GET', retrySafety: RetrySafety.Safe },
  'users.follow': { method: 'POST', retrySafety: RetrySafety.Unsafe },
  'users.unfollow': { method: 'DELETE', retrySafety: RetrySafety.Unsafe },
  'users.followers': { method: 'GET', retrySafety: RetrySafety.Safe },
  'users.following': { method: 'GET', retrySafety: RetrySafety.Safe },
  'users.followStatus': { method: 'POST', retrySafety: RetrySafety.Safe },
  'users.block': { method: 'POST', retrySafety: RetrySafety.Unsafe },
  'users.unblock': { method: 'DELETE', retrySafety: RetrySafety.Unsafe },
  'users.blocked': { method: 'GET', retrySafety: RetrySafety.Safe },
  'users.getPrivacy': { method: 'GET', retrySafety: RetrySafety.Safe },
  'users.updatePrivacy': { method: 'PUT', retrySafety: RetrySafety.Idempotent },
  'users.pins': { method: 'GET', retrySafety: RetrySafety.Safe },
  'users.setPin': { method: 'PUT', retrySafety: RetrySafety.Idempotent },
  'users.removePin': { method: 'DELETE', retrySafety: RetrySafety.Unsafe },

  'posts.list': { method: 'GET', retrySafety: RetrySafety.Safe },
  'posts.create': { method: 'POST', retrySafety: RetrySafety.Unsafe },
  'posts.get': { method: 'GET', retrySafety: RetrySafety.Safe },
  'posts.update': { method: 'PUT', retrySafety: RetrySafety.Idempotent },
  'posts.remove': { method: 'DELETE', retrySafety: RetrySafety.Unsafe },
  'posts.restore': { method: 'POST', retrySafety: RetrySafety.Unsafe },
  'posts.like': { method: 'POST', retrySafety: RetrySafety.Unsafe },
  'posts.unlike': { method: 'DELETE', retrySafety: RetrySafety.Unsafe },
  'posts.repost': { method: 'POST', retrySafety: RetrySafety.Unsafe },
  'posts.unrepost': { method: 'DELETE', retrySafety: RetrySafety.Unsafe },
  'posts.pin': { method: 'POST', retrySafety: RetrySafety.Unsafe },
  'posts.unpin': { method: 'DELETE', retrySafety: RetrySafety.Unsafe },
  'posts.vote': { method: 'POST', retrySafety: RetrySafety.Unsafe },
  'posts.stats': { method: 'POST', retrySafety: RetrySafety.Safe },
  'posts.byUser': { method: 'GET', retrySafety: RetrySafety.Safe },
  'posts.likedByUser': { method: 'GET', retrySafety: RetrySafety.Safe },
  'posts.comments': { method: 'GET', retrySafety: RetrySafety.Safe },
  'posts.comment': { method: 'POST', retrySafety: RetrySafety.Unsafe },

  'comments.replies': { method: 'GET', retrySafety: RetrySafety.Safe },
  'comments.reply': { method: 'POST', retrySafety: RetrySafety.Unsafe },
  'comments.update': { method: 'PATCH', retrySafety: RetrySafety.Idempotent },
  'comments.remove': { method: 'DELETE', retrySafety: RetrySafety.Unsafe },
  'comments.restore': { method: 'POST', retrySafety: RetrySafety.Unsafe },
  'comments.like': { method: 'POST', retrySafety: RetrySafety.Unsafe },
  'comments.unlike': { method: 'DELETE', retrySafety: RetrySafety.Unsafe },

  'files.upload': { method: 'POST', retrySafety: RetrySafety.Unsafe },
  'files.get': { method: 'GET', retrySafety: RetrySafety.Safe },
  'files.remove': { method: 'DELETE', retrySafety: RetrySafety.Unsafe },

  'notifications.list': { method: 'GET', retrySafety: RetrySafety.Safe },
  'notifications.count': { method: 'GET', retrySafety: RetrySafety.Safe },
  'notifications.markRead': { method: 'POST', retrySafety: RetrySafety.Idempotent },
  'notifications.markReadBatch': { method: 'POST', retrySafety: RetrySafety.Idempotent },
  'notifications.markAllRead': { method: 'POST', retrySafety: RetrySafety.Idempotent },
  'notifications.getSettings': { method: 'GET', retrySafety: RetrySafety.Safe },
  'notifications.updateSettings': { method: 'PUT', retrySafety: RetrySafety.Idempotent },

  'hashtags.search': { method: 'GET', retrySafety: RetrySafety.Safe },
  'hashtags.trending': { method: 'GET', retrySafety: RetrySafety.Safe },
  'hashtags.posts': { method: 'GET', retrySafety: RetrySafety.Safe },
  'search.all': { method: 'GET', retrySafety: RetrySafety.Safe },
  'reports.create': { method: 'POST', retrySafety: RetrySafety.Unsafe },

  'subscription.status': { method: 'GET', retrySafety: RetrySafety.Safe },
  'subscription.pay': { method: 'POST', retrySafety: RetrySafety.Unsafe },
  'subscription.setAutoRenewal': { method: 'POST', retrySafety: RetrySafety.Idempotent },
  'subscription.bindCard': { method: 'POST', retrySafety: RetrySafety.Unsafe },
  'subscription.methods': { method: 'GET', retrySafety: RetrySafety.Safe },
  'subscription.setDefaultMethod': { method: 'POST', retrySafety: RetrySafety.Idempotent },
  'subscription.removeMethod': { method: 'DELETE', retrySafety: RetrySafety.Unsafe },

  'verification.status': { method: 'GET', retrySafety: RetrySafety.Safe },
  'verification.submit': { method: 'POST', retrySafety: RetrySafety.Unsafe },

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
