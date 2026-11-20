import type { OperationId } from 'itd-api';
import type { CacheOperationId } from './operations.js';
import { CacheInvalidation, CachePolicyScope } from './policy.js';

export type MutationInvalidation = readonly OperationId[] | CacheInvalidation;

export interface CacheMutation {
  operationId: OperationId;
  invalidates: MutationInvalidation;
  /** По умолчанию зависимые операции удаляются у всех аккаунтов общего экземпляра. */
  scope?: typeof CachePolicyScope.Account | undefined;
}

const POST_CONTENT = [
  'posts.list',
  'posts.get',
  'posts.byUser',
  'posts.likedByUser',
  'posts.comments',
  'posts.stats',
  'comments.replies',
  'hashtags.trending',
  'hashtags.posts',
  'search.all',
  'users.me',
  'users.get',
  'users.pins',
] as const satisfies readonly CacheOperationId[];

const POST_REACTIONS = [
  'posts.list',
  'posts.get',
  'posts.byUser',
  'posts.likedByUser',
  'posts.stats',
  'hashtags.posts',
  'search.all',
] as const satisfies readonly CacheOperationId[];

const COMMENTS = [
  'posts.list',
  'posts.get',
  'posts.comments',
  'posts.stats',
  'comments.replies',
  'hashtags.posts',
  'search.all',
] as const satisfies readonly CacheOperationId[];

const PROFILE = [
  'users.me',
  'users.get',
  'users.checkUsername',
  'users.whoToFollow',
  'users.topClans',
  'users.followers',
  'users.following',
  'users.blocked',
  'users.getPrivacy',
  'users.pins',
  'users.followStatus',
  'posts.list',
  'posts.get',
  'posts.byUser',
  'posts.likedByUser',
  'posts.comments',
  'comments.replies',
  'hashtags.posts',
  'search.all',
] as const satisfies readonly CacheOperationId[];

const FOLLOWING = [
  'users.me',
  'users.get',
  'users.whoToFollow',
  'users.followers',
  'users.following',
  'users.followStatus',
  'posts.list',
  'posts.byUser',
  'search.all',
] as const satisfies readonly CacheOperationId[];

const BLOCKS = [
  'users.me',
  'users.get',
  'users.whoToFollow',
  'users.followers',
  'users.following',
  'users.blocked',
  'users.followStatus',
  'posts.list',
  'search.all',
] as const satisfies readonly CacheOperationId[];

const PINS = [
  'users.me',
  'users.get',
  'users.pins',
  'posts.list',
  'posts.get',
  'posts.byUser',
] as const satisfies readonly CacheOperationId[];

const NOTIFICATIONS = [
  'notifications.list',
  'notifications.count',
] as const satisfies readonly CacheOperationId[];

const CHAT_LIST = ['chats.list', 'chats.get'] as const satisfies readonly CacheOperationId[];
const CHAT_UNREAD = [...CHAT_LIST, 'chats.unread'] as const satisfies readonly CacheOperationId[];
const CHAT_REMOVAL = [
  ...CHAT_UNREAD,
  'chats.reactions',
] as const satisfies readonly CacheOperationId[];

const SUBSCRIPTION = [
  'subscription.status',
  'subscription.methods',
] as const satisfies readonly CacheOperationId[];

const SHOP_PRODUCTS = [
  'shop.products.list',
  'shop.products.get',
] as const satisfies readonly CacheOperationId[];

const NOTHING = [] as const satisfies readonly CacheOperationId[];

/**
 * Известные изменяющие запросы и читающие операции, чьи ответы они могут изменить.
 *
 * Каталог намеренно консервативен: лучше удалить несколько связанных списков, чем оставить
 * персонализированное поле или вложенный объект устаревшим.
 */
const CACHE_MUTATIONS = Object.freeze([
  // Авторизация и сессии.
  { operationId: 'auth.refresh', invalidates: NOTHING },
  { operationId: 'auth.resendOtp', invalidates: NOTHING },
  { operationId: 'auth.forgotPassword', invalidates: NOTHING },
  { operationId: 'auth.qrStart', invalidates: NOTHING },
  { operationId: 'auth.qrClaim', invalidates: NOTHING },
  { operationId: 'auth.qrScan', invalidates: NOTHING },
  {
    operationId: 'auth.qrApprove',
    invalidates: ['auth.sessions'],
    scope: CachePolicyScope.Account,
  },
  { operationId: 'auth.qrReject', invalidates: NOTHING },
  { operationId: 'auth.signUp', invalidates: CacheInvalidation.All },
  { operationId: 'auth.signIn', invalidates: CacheInvalidation.All },
  { operationId: 'auth.verifyOtp', invalidates: CacheInvalidation.All },
  { operationId: 'auth.logout', invalidates: CacheInvalidation.All },
  { operationId: 'auth.resetPassword', invalidates: CacheInvalidation.All },
  { operationId: 'auth.phone.start', invalidates: NOTHING },
  { operationId: 'auth.phone.resume', invalidates: NOTHING },
  { operationId: 'auth.phone.resend', invalidates: NOTHING },
  { operationId: 'auth.phone.reverseStart', invalidates: NOTHING },
  { operationId: 'auth.phone.verify', invalidates: CacheInvalidation.All },
  { operationId: 'auth.phone.password', invalidates: CacheInvalidation.All },
  { operationId: 'auth.phone.resetPassword', invalidates: CacheInvalidation.All },
  { operationId: 'auth.phone.reverseComplete', invalidates: CacheInvalidation.All },
  {
    operationId: 'auth.revokeSession',
    invalidates: ['auth.sessions'],
    scope: CachePolicyScope.Account,
  },
  {
    operationId: 'auth.revokeOtherSessions',
    invalidates: ['auth.sessions'],
    scope: CachePolicyScope.Account,
  },

  // Способы входа текущего аккаунта.
  { operationId: 'account.password.change', invalidates: CacheInvalidation.All },
  { operationId: 'account.deactivate', invalidates: PROFILE },
  { operationId: 'account.restore', invalidates: PROFILE },
  { operationId: 'account.password.set', invalidates: CacheInvalidation.All },
  { operationId: 'account.email.attach', invalidates: NOTHING },
  { operationId: 'account.phone.attach', invalidates: NOTHING },
  { operationId: 'account.email.startChange', invalidates: NOTHING },
  { operationId: 'account.phone.startChange', invalidates: NOTHING },
  { operationId: 'account.verifyChange', invalidates: NOTHING },
  { operationId: 'account.email.resendOtp', invalidates: NOTHING },
  { operationId: 'account.phone.resendOtp', invalidates: NOTHING },
  { operationId: 'account.phone.reverseStart', invalidates: NOTHING },
  { operationId: 'account.phone.reverseChangeComplete', invalidates: NOTHING },
  { operationId: 'account.changes.requestProof', invalidates: NOTHING },
  { operationId: 'account.changes.wait', invalidates: NOTHING },
  { operationId: 'account.changes.cancelPending', invalidates: NOTHING },
  {
    operationId: 'account.verifyAttach',
    invalidates: ['users.me'],
    scope: CachePolicyScope.Account,
  },
  {
    operationId: 'account.phone.sync',
    invalidates: ['users.me'],
    scope: CachePolicyScope.Account,
  },
  {
    operationId: 'account.phone.reverseAttachComplete',
    invalidates: ['users.me'],
    scope: CachePolicyScope.Account,
  },
  {
    operationId: 'account.changes.confirm',
    invalidates: ['users.me'],
    scope: CachePolicyScope.Account,
  },

  // Посты и комментарии.
  { operationId: 'posts.create', invalidates: POST_CONTENT },
  { operationId: 'posts.update', invalidates: POST_CONTENT },
  { operationId: 'posts.remove', invalidates: POST_CONTENT },
  { operationId: 'posts.restore', invalidates: POST_CONTENT },
  { operationId: 'posts.like', invalidates: POST_REACTIONS },
  { operationId: 'posts.unlike', invalidates: POST_REACTIONS },
  { operationId: 'posts.repost', invalidates: POST_CONTENT },
  { operationId: 'posts.unrepost', invalidates: POST_CONTENT },
  { operationId: 'posts.pin', invalidates: PINS },
  { operationId: 'posts.unpin', invalidates: PINS },
  { operationId: 'posts.vote', invalidates: POST_REACTIONS },
  { operationId: 'posts.comment', invalidates: COMMENTS },
  { operationId: 'comments.reply', invalidates: COMMENTS },
  { operationId: 'comments.update', invalidates: COMMENTS },
  { operationId: 'comments.remove', invalidates: COMMENTS },
  { operationId: 'comments.restore', invalidates: COMMENTS },
  { operationId: 'comments.like', invalidates: COMMENTS },
  { operationId: 'comments.unlike', invalidates: COMMENTS },

  // Профиль и связи между пользователями.
  { operationId: 'users.updateMe', invalidates: PROFILE },
  { operationId: 'users.createProfile', invalidates: PROFILE },
  { operationId: 'users.follow', invalidates: FOLLOWING },
  { operationId: 'users.unfollow', invalidates: FOLLOWING },
  { operationId: 'users.block', invalidates: BLOCKS },
  { operationId: 'users.unblock', invalidates: BLOCKS },
  {
    operationId: 'users.updatePrivacy',
    invalidates: ['users.me', 'users.get', 'users.getPrivacy'],
  },
  { operationId: 'users.setPin', invalidates: PINS },
  { operationId: 'users.removePin', invalidates: PINS },

  // Уведомления.
  {
    operationId: 'notifications.markRead',
    invalidates: NOTIFICATIONS,
    scope: CachePolicyScope.Account,
  },
  {
    operationId: 'notifications.markReadBatch',
    invalidates: NOTIFICATIONS,
    scope: CachePolicyScope.Account,
  },
  {
    operationId: 'notifications.markAllRead',
    invalidates: NOTIFICATIONS,
    scope: CachePolicyScope.Account,
  },
  {
    operationId: 'notifications.updateSettings',
    invalidates: ['notifications.getSettings'],
    scope: CachePolicyScope.Account,
  },

  // Чаты.
  { operationId: 'chats.fileLinks', invalidates: NOTHING },
  { operationId: 'chats.upload.init', invalidates: NOTHING },
  { operationId: 'chats.upload.part', invalidates: NOTHING },
  { operationId: 'chats.upload.finalize', invalidates: NOTHING },
  { operationId: 'chats.presenceMany', invalidates: NOTHING },
  { operationId: 'chats.heardMessages', invalidates: NOTHING },
  { operationId: 'chats.createDirect', invalidates: CHAT_LIST },
  { operationId: 'chats.sendMessage', invalidates: CHAT_UNREAD },
  { operationId: 'chats.sendMessageToUser', invalidates: CHAT_UNREAD },
  { operationId: 'chats.editMessage', invalidates: CHAT_LIST },
  { operationId: 'chats.forwardMessages', invalidates: CHAT_UNREAD },
  {
    operationId: 'chats.deleteMessagesForMe',
    invalidates: CHAT_REMOVAL,
    scope: CachePolicyScope.Account,
  },
  { operationId: 'chats.deleteMessagesForAll', invalidates: CHAT_REMOVAL },
  {
    operationId: 'chats.setPinned',
    invalidates: CHAT_LIST,
    scope: CachePolicyScope.Account,
  },
  {
    operationId: 'chats.setMuted',
    invalidates: CHAT_LIST,
    scope: CachePolicyScope.Account,
  },
  {
    operationId: 'chats.setUnread',
    invalidates: CHAT_UNREAD,
    scope: CachePolicyScope.Account,
  },
  { operationId: 'chats.markRead', invalidates: CHAT_UNREAD },
  { operationId: 'chats.acceptRequest', invalidates: CHAT_LIST },
  { operationId: 'chats.markHeard', invalidates: NOTHING },
  { operationId: 'chats.sendAction', invalidates: NOTHING },
  {
    operationId: 'chats.clearHistory',
    invalidates: CHAT_REMOVAL,
    scope: CachePolicyScope.Account,
  },
  { operationId: 'chats.clearHistoryForAll', invalidates: CHAT_REMOVAL },
  { operationId: 'chats.delete', invalidates: CHAT_REMOVAL },
  { operationId: 'chats.setReactions', invalidates: ['chats.reactions'] },

  // Файлы и настройки аккаунта.
  { operationId: 'files.upload', invalidates: NOTHING },
  { operationId: 'files.uploadBannerDrawing', invalidates: NOTHING },
  { operationId: 'files.remove', invalidates: POST_CONTENT },
  {
    operationId: 'verification.submit',
    invalidates: ['verification.status'],
    scope: CachePolicyScope.Account,
  },
  {
    operationId: 'subscription.pay',
    invalidates: SUBSCRIPTION,
    scope: CachePolicyScope.Account,
  },
  {
    operationId: 'subscription.setAutoRenewal',
    invalidates: SUBSCRIPTION,
    scope: CachePolicyScope.Account,
  },
  {
    operationId: 'subscription.bindCard',
    invalidates: SUBSCRIPTION,
    scope: CachePolicyScope.Account,
  },
  {
    operationId: 'subscription.setDefaultMethod',
    invalidates: SUBSCRIPTION,
    scope: CachePolicyScope.Account,
  },
  {
    operationId: 'subscription.removeMethod',
    invalidates: SUBSCRIPTION,
    scope: CachePolicyScope.Account,
  },

  // Магазин: заказ уменьшает остаток товара.
  { operationId: 'shop.orders.create', invalidates: SHOP_PRODUCTS },
  { operationId: 'shop.orders.pay', invalidates: SHOP_PRODUCTS },
  { operationId: 'shop.orders.requestAccessCode', invalidates: NOTHING },
  { operationId: 'shop.orders.verifyAccessCode', invalidates: NOTHING },
  { operationId: 'shop.consents.record', invalidates: NOTHING },

  // Эти запросы не меняют ни один доступный для кэширования ответ.
  { operationId: 'reports.create', invalidates: NOTHING },
  { operationId: 'telemetry.dwell', invalidates: NOTHING },
  { operationId: 'telemetry.interaction', invalidates: NOTHING },
] as const satisfies readonly CacheMutation[]);

// Списки инвалидации разделяются несколькими мутациями, а `cacheMutation()` отдаёт
// дескриптор наружу. Замораживаем и его, и список, чтобы случайное изменение одного
// результата не переписало каталог для всех остальных операций.
for (const mutation of CACHE_MUTATIONS) {
  Object.freeze(mutation.invalidates);
  Object.freeze(mutation);
}

/** ID мутации из каталога. */
export type CacheMutationId = (typeof CACHE_MUTATIONS)[number]['operationId'];

const MUTATIONS = new Map<OperationId, CacheMutation>(
  CACHE_MUTATIONS.map((mutation) => [mutation.operationId, mutation]),
);

/** Находит известную мутацию по стабильному семантическому ID. */
export function cacheMutation(operationId: OperationId): CacheMutation | undefined {
  return MUTATIONS.get(operationId);
}
