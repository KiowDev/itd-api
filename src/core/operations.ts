/** HTTP-метод встроенной операции. */
export type OperationMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Минимальное стабильное описание операции, доступное core и плагинам. */
export interface OperationDefinition {
  readonly method: OperationMethod;
}

/**
 * Каталог встроенных операций.
 *
 * ID описывает смысл вызова и не меняется при переносе HTTP-пути. Method хранится здесь,
 * чтобы resources и плагины не вели независимые таблицы `operation -> method`.
 */
export const OPERATIONS = Object.freeze({
  'auth.check': { method: 'GET' },
  'auth.signUp': { method: 'POST' },
  'auth.signIn': { method: 'POST' },
  'auth.verifyOtp': { method: 'POST' },
  'auth.resendOtp': { method: 'POST' },
  'auth.refresh': { method: 'POST' },
  'auth.logout': { method: 'POST' },
  'auth.forgotPassword': { method: 'POST' },
  'auth.resetPassword': { method: 'POST' },
  'auth.changePassword': { method: 'POST' },
  'auth.sessions': { method: 'GET' },
  'auth.revokeSession': { method: 'DELETE' },
  'auth.revokeOtherSessions': { method: 'DELETE' },

  'users.me': { method: 'GET' },
  'users.updateMe': { method: 'PUT' },
  'users.deactivate': { method: 'DELETE' },
  'users.restore': { method: 'POST' },
  'users.createProfile': { method: 'POST' },
  'users.get': { method: 'GET' },
  'users.checkUsername': { method: 'GET' },
  'users.search': { method: 'GET' },
  'users.whoToFollow': { method: 'GET' },
  'users.topClans': { method: 'GET' },
  'users.follow': { method: 'POST' },
  'users.unfollow': { method: 'DELETE' },
  'users.followers': { method: 'GET' },
  'users.following': { method: 'GET' },
  'users.followStatus': { method: 'POST' },
  'users.block': { method: 'POST' },
  'users.unblock': { method: 'DELETE' },
  'users.blocked': { method: 'GET' },
  'users.getPrivacy': { method: 'GET' },
  'users.updatePrivacy': { method: 'PUT' },
  'users.pins': { method: 'GET' },
  'users.setPin': { method: 'PUT' },
  'users.removePin': { method: 'DELETE' },

  'posts.list': { method: 'GET' },
  'posts.create': { method: 'POST' },
  'posts.get': { method: 'GET' },
  'posts.update': { method: 'PUT' },
  'posts.remove': { method: 'DELETE' },
  'posts.restore': { method: 'POST' },
  'posts.like': { method: 'POST' },
  'posts.unlike': { method: 'DELETE' },
  'posts.repost': { method: 'POST' },
  'posts.unrepost': { method: 'DELETE' },
  'posts.pin': { method: 'POST' },
  'posts.unpin': { method: 'DELETE' },
  'posts.vote': { method: 'POST' },
  'posts.stats': { method: 'POST' },
  'posts.byUser': { method: 'GET' },
  'posts.likedByUser': { method: 'GET' },
  'posts.comments': { method: 'GET' },
  'posts.comment': { method: 'POST' },

  'comments.replies': { method: 'GET' },
  'comments.reply': { method: 'POST' },
  'comments.update': { method: 'PATCH' },
  'comments.remove': { method: 'DELETE' },
  'comments.restore': { method: 'POST' },
  'comments.like': { method: 'POST' },
  'comments.unlike': { method: 'DELETE' },

  'files.upload': { method: 'POST' },
  'files.get': { method: 'GET' },
  'files.remove': { method: 'DELETE' },

  'notifications.list': { method: 'GET' },
  'notifications.count': { method: 'GET' },
  'notifications.markRead': { method: 'POST' },
  'notifications.markReadBatch': { method: 'POST' },
  'notifications.markAllRead': { method: 'POST' },
  'notifications.getSettings': { method: 'GET' },
  'notifications.updateSettings': { method: 'PUT' },

  'hashtags.search': { method: 'GET' },
  'hashtags.trending': { method: 'GET' },
  'hashtags.posts': { method: 'GET' },
  'search.all': { method: 'GET' },
  'reports.create': { method: 'POST' },

  'subscription.status': { method: 'GET' },
  'subscription.pay': { method: 'POST' },
  'subscription.setAutoRenewal': { method: 'POST' },
  'subscription.bindCard': { method: 'POST' },
  'subscription.methods': { method: 'GET' },
  'subscription.setDefaultMethod': { method: 'POST' },
  'subscription.removeMethod': { method: 'DELETE' },

  'verification.status': { method: 'GET' },
  'verification.submit': { method: 'POST' },

  'platform.version': { method: 'GET' },
  'platform.changelog': { method: 'GET' },
  'platform.announcements': { method: 'GET' },
  'platform.portal': { method: 'GET' },
  'platform.status': { method: 'GET' },

  'telemetry.dwell': { method: 'POST' },
  'telemetry.interaction': { method: 'POST' },
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
