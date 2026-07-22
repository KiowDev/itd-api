/**
 * `itd-api` — клиент REST и realtime API социальной сети итд.com.
 *
 * @packageDocumentation
 */

// Билдеры: фабрики — обычные функции, классы отдаются только как типы,
// поэтому единственная точка входа — фабрика. Подробности — в builders/base.ts.
export type { BuilderInput, ItdBuilder } from './builders/base.js';
export { isBuilder } from './builders/base.js';
export { type CommentBuilder, type CommentInput, comment } from './builders/comment.js';
export { type PollBuilder, type PollInput, poll } from './builders/poll.js';
export { type PostBuilder, type PostInput, post } from './builders/post.js';
export { type ReportBuilder, type ReportInput, report } from './builders/report.js';
export { createClient, ItdClient } from './client.js';
export { AUTH_PATHS, DEVICE_ID_HEADER, TURNSTILE_SITE_KEY } from './core/auth.js';
export {
  DEFAULT_BASE_URL,
  DEFAULT_TIMEOUT,
  DEFAULT_USER_AGENT,
  LIBRARY_VERSION,
} from './core/config.js';
export { AUTH_FLAG_COOKIE, REFRESH_COOKIE, REFRESH_COOKIE_PATH } from './core/cookies.js';
export type { Listener, Unsubscribe } from './core/emitter.js';
export {
  ItdAbortError,
  ItdApiError,
  type ItdApiErrorInit,
  ItdApiErrorKind,
  ItdAuthError,
  ItdConfigError,
  ItdConflictError,
  ItdError,
  ItdErrorKind,
  type ItdFieldErrors,
  ItdForbiddenError,
  ItdNetworkError,
  ItdNotFoundError,
  ItdPhoneVerificationError,
  ItdRateLimitError,
  ItdServerError,
  ItdTimeoutError,
  ItdValidationError,
  isItdApiError,
  isItdAuthError,
  isItdConflictError,
  isItdError,
  isItdForbiddenError,
  isItdNotFoundError,
  isItdPhoneVerificationError,
  isItdRateLimitError,
  isItdServerError,
  isItdValidationError,
} from './core/errors.js';
export {
  ALLOWED_MIME_TYPES,
  type AllowedMimeType,
  AUDIO_MIME_TYPES,
  type AudioMimeType,
  IMAGE_MIME_TYPES,
  type ImageMimeType,
  VIDEO_MIME_TYPES,
  type VideoMimeType,
} from './core/mime.js';
export type { Page, PageState } from './core/pagination.js';
export { PaginationMode, Paginator } from './core/pagination.js';
// Плагины работают на уровне транспорта: обёртка вокруг запроса видит и тело запроса,
// и разобранный ответ. Подробности — в core/plugins.ts.
export type { ItdPlugin, PluginContext, Transformer } from './core/plugins.js';
export { DetectedRuntime, RuntimeMode } from './core/runtime.js';
export {
  createTokenStorage,
  type ItdSession,
  LocalStorageTokenStorage,
  MemoryTokenStorage,
  type TokenStorage,
} from './core/storage.js';
// Уведомления приводятся к единой форме, поэтому объекты из REST и из потока событий
// можно складывать в один список. Подробности — в notifications/normalize.ts.
export {
  type NotificationEvent,
  normalizeNotification,
  readNotificationEvent,
  readUnreadCountEvent,
} from './notifications/normalize.js';
export { formatNotificationText } from './notifications/text.js';
export {
  canonicalNotificationType,
  isKnownNotificationType,
  NOTIFICATION_TYPE_ALIASES,
} from './notifications/type-map.js';
export { resolveNotificationUrl } from './notifications/url.js';
export type { PollTransportOptions } from './realtime/poll.js';
export {
  MAX_RECONNECT_ATTEMPTS,
  RECONNECT_BACKOFF,
  RECONNECT_JITTER,
  type ReconnectOptions,
} from './realtime/reconnect.js';
export { type SseTransportOptions, STREAM_PATH } from './realtime/sse.js';
export {
  ItdRealtime,
  type RealtimeEvents,
  type RealtimeOptions,
  RealtimeTransportKind,
} from './realtime/stream.js';
export type { RealtimeTransport, TransportContext, TransportEvent } from './realtime/transport.js';
// Нужен тем, кто пишет свой транспорт: только этой ошибкой он сообщает потоку,
// что токен пора обновить.
export { UnauthorizedStreamError } from './realtime/transport.js';
export type {
  AuthResource,
  CaptchaCredentials,
  Credentials,
  ForgotPasswordInput,
  ResetPasswordInput,
  SignInResult,
} from './resources/auth.js';
export { OAuthProvider, SignInStatus } from './resources/auth.js';
export type { CommentsResource, RepliesParams } from './resources/comments.js';
export type { FilesResource, UploadedFile, UploadOptions } from './resources/files.js';
export type {
  DwellEntry,
  HashtagPostsParams,
  HashtagsResource,
  InteractionEntry,
  PlatformResource,
  ReportsResource,
  SearchResource,
  SearchResult,
  SubscriptionResource,
  TelemetryResource,
  VerificationResource,
} from './resources/misc.js';
export type {
  NotificationListParams,
  NotificationsResource,
  UpdateNotificationSettingsInput,
} from './resources/notifications.js';
export type {
  CommentsParams,
  FeedParams,
  PostsResource,
  UserPostsParams,
} from './resources/posts.js';
export type {
  UpdatePrivacyInput,
  UpdateProfileInput,
  UserListParams,
  UsersResource,
} from './resources/users.js';
export type { Loose } from './types/enums.js';
// Перечисления экспортируются парой «значение + тип» под одним именем:
// FeedTab.Popular работает как константа, FeedTab — как тип. Подробности — в types/enums.ts.
export {
  AttachmentType,
  CommentSort,
  FeedTab,
  ItdErrorCode,
  LikesVisibility,
  NotificationType,
  RealtimeStatus,
  ReportReason,
  ReportTargetType,
  SpanType,
  WallAccess,
} from './types/enums.js';
export type {
  Actor,
  Announcement,
  AnnouncementButton,
  Attachment,
  Author,
  ChangelogEntry,
  Clan,
  Comment,
  CommentReplyTo,
  FollowResult,
  Hashtag,
  IsoDate,
  LikeResult,
  MyProfile,
  Notification,
  NotificationSettings,
  PaymentMethod,
  Pin,
  PinPostResult,
  PinsResult,
  Poll,
  PollOption,
  Portal,
  Post,
  PostStats,
  PrivacySettings,
  Profile,
  PublicProfile,
  Report,
  Session,
  Span,
  Subscription,
  SubscriptionState,
  UserId,
  UserRef,
  UserSummary,
  VerificationStatus,
} from './types/models.js';
export { isMyProfile, toDate } from './types/models.js';
export type {
  AuthInput,
  ClientHooks,
  CredentialsAuth,
  ErrorContextHook,
  ItdClientOptions,
  Logger,
  RateLimitOptions,
  RawRequestOptions,
  RequestContext,
  RequestOptions,
  ResponseContext,
  RetryContext,
  RetryOptions,
} from './types/options.js';
export type {
  CreateCommentInput,
  CreatePollInput,
  CreatePostInput,
  CreateReportInput,
  FileInput,
} from './types/params.js';
