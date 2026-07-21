/**
 * Перечисления API итд.com.
 *
 * Здесь намеренно не используется `enum` из TypeScript. Вместо него — пара «замороженный
 * объект + одноимённый тип». Такой приём даёт всё, ради чего берут `enum`
 * (`FeedTab.Popular`, перебор значений в рантайме), и при этом:
 *
 * - **стирается без остатка** — `enum` порождает рантайм-код и отвергается средами,
 *   которые просто срезают типы (`node --experimental-strip-types`);
 * - **не запрещает обычные строки** — `itd.posts.list({ tab: 'popular' })` остаётся валидным,
 *   тогда как строковый `enum` считает это ошибкой типа и вынуждает всех импортировать себя;
 * - **позволяет открытые множества** — там, где документация перечисляет значения не полностью,
 *   тип расширяется через {@link Loose}, а объект остаётся справочником известных значений.
 *
 * @example
 * ```ts
 * import { FeedTab } from 'itd-api';
 *
 * await itd.posts.list({ tab: FeedTab.Popular });  // без магических строк
 * await itd.posts.list({ tab: 'popular' });        // и так тоже можно
 *
 * Object.values(FeedTab);                          // ['popular', 'following', 'clan']
 * ```
 *
 * @packageDocumentation
 */

/**
 * Открытое строковое перечисление.
 *
 * Даёт автодополнение известных значений, но не ломается, если сервер пришлёт новое.
 * Используется там, где документация API перечисляет значения не полностью («`everyone` и др.»).
 */
export type Loose<T extends string> = T | (string & {});

/**
 * Вкладка ленты `GET /api/posts`.
 *
 * Множество закрытое: неизвестное значение сервер отвергнет.
 */
export const FeedTab = Object.freeze({
  /** Популярное. Курсор здесь — номер страницы в виде строки (`"2"`, `"6"`…). */
  Popular: 'popular',
  /** Записи тех, на кого вы подписаны. Курсор — отметка времени последнего поста. */
  Following: 'following',
  /** Лента клана. Курсор, как и в подписках, — отметка времени. */
  Clan: 'clan',
} as const);
export type FeedTab = (typeof FeedTab)[keyof typeof FeedTab];

/** Порядок комментариев к посту. */
export const CommentSort = Object.freeze({
  /** Сначала новые. */
  Newest: 'newest',
  /** Сначала старые. */
  Oldest: 'oldest',
  /** Сначала популярные. */
  Popular: 'popular',
} as const);
export type CommentSort = (typeof CommentSort)[keyof typeof CommentSort];

/** Тип вложения. */
export const AttachmentType = Object.freeze({
  Image: 'image',
  Video: 'video',
  /** Голосовые комментарии: `audio/ogg`, с полем `duration`. */
  Audio: 'audio',
} as const);
export type AttachmentType = (typeof AttachmentType)[keyof typeof AttachmentType];

/** На что подаётся жалоба. */
export const ReportTargetType = Object.freeze({
  Post: 'post',
  Comment: 'comment',
  User: 'user',
} as const);
export type ReportTargetType = (typeof ReportTargetType)[keyof typeof ReportTargetType];

/** Причина жалобы. Множество закрытое. */
export const ReportReason = Object.freeze({
  Spam: 'spam',
  Violence: 'violence',
  Hate: 'hate',
  Adult: 'adult',
  Fraud: 'fraud',
  Other: 'other',
} as const);
export type ReportReason = (typeof ReportReason)[keyof typeof ReportReason];

/** Состояние realtime-соединения. */
export const RealtimeStatus = Object.freeze({
  Connecting: 'connecting',
  Connected: 'connected',
  Error: 'error',
  Disconnected: 'disconnected',
} as const);
export type RealtimeStatus = (typeof RealtimeStatus)[keyof typeof RealtimeStatus];

/**
 * Кто может писать на стену профиля.
 *
 * Документация перечисляет значения не полностью, поэтому тип открытый: объект ниже —
 * справочник известных значений, но сервер может прислать и другое.
 */
export const WallAccess = Object.freeze({
  Everyone: 'everyone',
} as const);
export type WallAccess = Loose<(typeof WallAccess)[keyof typeof WallAccess]>;

/** Кто видит реакции пользователя. Список в документации неполный. */
export const LikesVisibility = Object.freeze({
  Everyone: 'everyone',
  /** Только взаимные подписки. */
  Mutual: 'mutual',
} as const);
export type LikesVisibility = Loose<(typeof LikesVisibility)[keyof typeof LikesVisibility]>;

/**
 * Канонический тип уведомления (новое поколение имён).
 *
 * REST-эндпоинт `/api/notifications/` отдаёт старые имена (`like`, `comment`, `reply`,
 * `repost`, `mention`), SSE-поток — новые. Библиотека приводит их к этому набору,
 * сохраняя исходное значение в поле `rawType`.
 */
export const NotificationType = Object.freeze({
  /** Реакция на пост. Старое имя — `like`. */
  PostReaction: 'post_reaction',
  /** Комментарий к посту. Старое имя — `comment`. */
  PostComment: 'post_comment',
  /** Ответ на комментарий. Старое имя — `reply`. */
  CommentReply: 'comment_reply',
  /** Репост. Старое имя — `repost`. */
  PostRepost: 'post_repost',
  /** Упоминание в посте. Старое имя — `mention`. */
  PostMention: 'post_mention',
  /** Реакция на комментарий. */
  CommentReaction: 'comment_reaction',
  /** Упоминание в комментарии. */
  CommentMention: 'comment_mention',
  /** Запись на вашей стене. */
  WallPost: 'wall_post',
  /** На вас подписались. */
  Follow: 'follow',
  /** Заявка на подписку (закрытый профиль). */
  FollowRequest: 'follow_request',
  /** Заявка на подписку принята. */
  FollowAccepted: 'follow_accepted',
  /** Верификация одобрена. Приходит только по REST. */
  VerificationApproved: 'verification_approved',
  /** Верификация отклонена. Приходит только по REST. */
  VerificationRejected: 'verification_rejected',
} as const);
export type NotificationType = Loose<(typeof NotificationType)[keyof typeof NotificationType]>;

/**
 * Строковые коды ошибок из поля `code`.
 *
 * Ключи намеренно повторяют написание сервера: код из ответа API можно найти здесь
 * поиском один в один, без мысленного перевода регистра.
 *
 * Список открыт — сервер может добавить новый код, и это не должно ломать типизацию.
 *
 * @example
 * ```ts
 * if (err.hasCode(ItdErrorCode.OTP_INVALID)) await restartOtpFlow();
 * ```
 */
export const ItdErrorCode = Object.freeze({
  BAD_REQUEST: 'BAD_REQUEST',
  UNAUTHORIZED: 'UNAUTHORIZED',
  ACCESS_DENIED: 'ACCESS_DENIED',
  ENTITY_NOT_FOUND: 'ENTITY_NOT_FOUND',
  ENTITY_ALREADY_EXISTS: 'ENTITY_ALREADY_EXISTS',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  BUSINESS_RULE_VIOLATION: 'BUSINESS_RULE_VIOLATION',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',
  CAPTCHA_FAILED: 'CAPTCHA_FAILED',
  OTP_INVALID: 'OTP_INVALID',
  ACCOUNT_DEACTIVATED: 'ACCOUNT_DEACTIVATED',
  ACCOUNT_EMAIL_DOMAIN_NOT_ALLOWED: 'ACCOUNT_EMAIL_DOMAIN_NOT_ALLOWED',
  ACCOUNT_INVALID_CREDENTIALS: 'ACCOUNT_INVALID_CREDENTIALS',
  ACCOUNT_TEMPORARILY_LOCKED: 'ACCOUNT_TEMPORARILY_LOCKED',
  ACCOUNT_CURRENT_PASSWORD_INCORRECT: 'ACCOUNT_CURRENT_PASSWORD_INCORRECT',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  SESSION_REVOKED: 'SESSION_REVOKED',
  SESSION_INVALID_REFRESH_TOKEN: 'SESSION_INVALID_REFRESH_TOKEN',
  MISSING_FLOW_TOKEN: 'MISSING_FLOW_TOKEN',
  PROFILE_USERNAME_TAKEN: 'PROFILE_USERNAME_TAKEN',
  PROFILE_RESTRICTION_ACTIVE: 'PROFILE_RESTRICTION_ACTIVE',
  PROFILE_MODIFICATION_RESTRICTED: 'PROFILE_MODIFICATION_RESTRICTED',
  CONTENT_MODERATION_FAILED: 'CONTENT_MODERATION_FAILED',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  UNSUPPORTED_FILE_TYPE: 'UNSUPPORTED_FILE_TYPE',
  UPLOAD_FAILED: 'UPLOAD_FAILED',
  VIDEO_REQUIRES_VERIFICATION: 'VIDEO_REQUIRES_VERIFICATION',
  PHONE_VERIFICATION_REQUIRED: 'PHONE_VERIFICATION_REQUIRED',
  WRITE_ACCESS_RESTRICTED: 'WRITE_ACCESS_RESTRICTED',
} as const);
export type ItdErrorCode = Loose<(typeof ItdErrorCode)[keyof typeof ItdErrorCode]>;
