/**
 * `itd-api` — клиент REST и realtime API социальной сети итд.com.
 *
 * @packageDocumentation
 */

// Несколько аккаунтов в одном контейнере: у каждого свой токен, cookie и deviceId,
// а сессии складываются в одно хранилище. Подробности — в accounts.ts.
export type {
  AccountEvents,
  AddAccountOptions,
  ItdAccountsOptions,
  RateLimitScope,
  RemoveAccountOptions,
} from './accounts.js';
export { createAccounts, ItdAccounts } from './accounts.js';
// Билдеры: фабрики — обычные функции, классы отдаются только как типы,
// поэтому единственная точка входа — фабрика. Подробности — в builders/base.ts.
export type { BuilderInput, ItdBuilder } from './builders/base.js';
export { isBuilder } from './builders/base.js';
export { type CommentBuilder, type CommentInput, comment } from './builders/comment.js';
export {
  type AutoSpansOptions,
  autoSpans,
  type MarkupBuilder,
  type MarkupContent,
  type MarkupInput,
  type MarkupSpan,
  markup,
  type TextMarkup,
} from './builders/markup.js';
export { type PollBuilder, type PollInput, poll } from './builders/poll.js';
export {
  type CreatePostInput,
  type PostBuilder,
  type PostInput,
  type PostUpdateInput,
  post,
} from './builders/post.js';
export { type ReportBuilder, type ReportInput, report } from './builders/report.js';
export { createClient, ItdClient } from './client.js';
// Форма вложения сама объявляет, откуда брать содержимое, поэтому настраивать клиент
// не нужно. Загрузка по адресу работает на всех платформах и живёт здесь; чтение с диска
// требует `node:fs` — за ним `fromPath` из `itd-api/node`.
export {
  DEFAULT_FILE_STREAM_BUFFER_BYTES,
  DEFAULT_URL_FILE_MAX_BYTES,
  type FileContent,
  type FileContext,
  type FileInput,
  type FileStreamContent,
  type FileStreamOptions,
  FileTransferMode,
  type FromStreamOptions,
  fromStream,
  fromUrl,
  type LazyFile,
  type StreamFile,
  type UrlFile,
  type UrlFileOptions,
} from './core/attachments.js';
export {
  AUTH_PATHS,
  type AuthEvents,
  type AuthIdentity,
  DEVICE_ID_HEADER,
  TURNSTILE_SITE_KEY,
} from './core/auth.js';
export { type ItdClock, systemClock } from './core/clock.js';
export {
  BUILT_IN_SERVICES,
  DEFAULT_BASE_URL,
  DEFAULT_STATUS_BASE_URL,
  DEFAULT_TIMEOUT,
  DEFAULT_USER_AGENT,
  LIBRARY_VERSION,
  STATUS_SERVICE,
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
  ItdFileError,
  ItdFileErrorReason,
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
  isItdFileError,
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
// Хранилище на несколько аккаунтов: те же операции, но с именем аккаунта в каждой.
// Подробности — в core/multi-storage.ts.
export {
  createMultiTokenStorage,
  createRecordMultiStorage,
  MemoryMultiTokenStorage,
  type MultiTokenStorage,
  type RecordStorageSource,
  scopedTokenStorage,
} from './core/multi-storage.js';
export type { Page, PageState, PaginatorOptions } from './core/pagination.js';
export { mapPage, PaginationMode, Paginator } from './core/pagination.js';
// Плагины работают на уровне транспорта: обёртка вокруг запроса видит и тело запроса,
// и разобранный ответ. Подробности — в core/plugins.ts.
export type {
  ItdPlugin,
  PluginContext,
  PluginTeardown,
  Transformer,
} from './core/plugins.js';
export { DetectedRuntime, RuntimeMode } from './core/runtime.js';
// Сервисы — домены платформы, отличные от основного. Подробности — в core/services.ts.
export { type ServiceDefinition, ServiceRegistry } from './core/services.js';
// Платформенные хранилища живут в своих точках входа: `FileTokenStorage` требует `node:fs`
// и потому не может попасть в нейтральный бандл, а `LocalStorageTokenStorage` вынесен
// в `itd-api/web`, чтобы его молчаливый откат в память выбирали осознанно.
export {
  createTokenStorage,
  type ItdSession,
  MemoryTokenStorage,
  type TokenStorage,
} from './core/storage.js';
export { toDate, utcStampToIso } from './core/time.js';
export type { QueryParams, QueryValue } from './core/url.js';
export type { PaymentMethod, Session, Subscription } from './models/account.js';
export type { IsoDate, Span, UserId, UserRef } from './models/common.js';
export type {
  Attachment,
  Comment,
  CommentReplyTo,
  Hashtag,
  LikeResult,
  PinPostResult,
  Poll,
  PollOption,
  Post,
  PostStats,
} from './models/content.js';
export { isMyProfile } from './models/guards.js';
export type { Notification, NotificationSettings } from './models/notifications.js';
export type {
  Announcement,
  AnnouncementButton,
  ChangelogEntry,
  Clan,
  Portal,
  Report,
  VerificationStatus,
} from './models/platform.js';
export type {
  PlatformStatus,
  ServiceStatus,
  StatusDay,
  StatusIncidentLine,
} from './models/status.js';
export { statusDays } from './models/status-helpers.js';
export type {
  Actor,
  Author,
  AuthState,
  FollowResult,
  MyProfile,
  Pin,
  PinsResult,
  PrivacySettings,
  Profile,
  PublicProfile,
  SubscriptionState,
  UserSummary,
} from './models/users.js';
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
export type {
  RealtimeHandler,
  RealtimeMiddleware,
  RealtimeNext,
  RealtimePredicate,
  RealtimeSequentializer,
  RealtimeTypeGuard,
} from './realtime/middleware.js';
export type { PollTransportOptions } from './realtime/poll.js';
export {
  MAX_RECONNECT_ATTEMPTS,
  RECONNECT_BACKOFF,
  RECONNECT_JITTER,
  type ReconnectOptions,
} from './realtime/reconnect.js';
export { RealtimeRouter, type RealtimeRouteSelector } from './realtime/router.js';
export { type SseTransportOptions, STREAM_PATH } from './realtime/sse.js';
export {
  ItdRealtime,
  type RealtimeDeps,
  type RealtimeEvents,
  type RealtimeOptions,
  RealtimeTransportKind,
} from './realtime/stream.js';
export type { RealtimeTransport, TransportContext, TransportEvent } from './realtime/transport.js';
// Нужен тем, кто пишет свой транспорт: только этой ошибкой он сообщает потоку,
// что токен пора обновить.
export { UnauthorizedStreamError } from './realtime/transport.js';
export {
  type NotificationEventOfType,
  type NotificationOfType,
  type RealtimeContext,
  type RealtimeNotificationContext,
  type RealtimeNotificationFilter,
  type RealtimeNotificationSelector,
  type RealtimeNotificationUpdate,
  type RealtimeUnknownUpdate,
  type RealtimeUnreadCountUpdate,
  type RealtimeUpdate,
  type RealtimeUpdateOfType,
  RealtimeUpdateOrigin,
  RealtimeUpdateType,
} from './realtime/updates.js';
export type {
  AuthResource,
  CaptchaCredentials,
  Credentials,
  ForgotPasswordInput,
  ResetPasswordInput,
  SignInResult,
} from './resources/auth.js';
export { SignInStatus } from './resources/auth.js';
export type { CommentsResource, RepliesParams } from './resources/comments.js';
export {
  DEFAULT_UPLOAD_TIMEOUT,
  type FilesResource,
  type UploadedFile,
  type UploadOptions,
} from './resources/files.js';
export type { HashtagPostsParams, HashtagsResource } from './resources/hashtags.js';
export type {
  NotificationListParams,
  NotificationsResource,
  UpdateNotificationSettingsInput,
} from './resources/notifications.js';
export type {
  PlatformClientVersion,
  PlatformResource,
  PlatformVersions,
} from './resources/platform.js';
export type {
  CommentsParams,
  FeedParams,
  PostsResource,
  UserPostsParams,
} from './resources/posts.js';
export type { ReportsResource } from './resources/reports.js';
export type { SearchResource, SearchResult } from './resources/search.js';
export type { SubscriptionResource } from './resources/subscription.js';
export type {
  DwellEntry,
  InteractionEntry,
  PhotoOpenInput,
  TelemetryBatch,
  TelemetryBatchOptions,
  TelemetryClock,
  TelemetryOptions,
  TelemetryResource,
  VideoProgressInput,
  ViewTracker,
  ViewTrackerInput,
  ViewTrackerOptions,
} from './resources/telemetry.js';
export type {
  UpdatePrivacyInput,
  UpdateProfileInput,
  UserListParams,
  UsersResource,
} from './resources/users.js';
export type { VerificationResource } from './resources/verification.js';
export {
  type ParseMarkupOptions,
  parseHtml,
  parseMarkdown,
} from './spans/parse.js';
export {
  type RenderSpansOptions,
  renderSpans,
  SpanRenderFormat,
} from './spans/render.js';
export type { Loose } from './types/enums.js';
// Перечисления экспортируются парой «значение + тип» под одним именем:
// FeedTab.Popular работает как константа, FeedTab — как тип. Подробности — в types/enums.ts.
export {
  AccessType,
  AttachmentType,
  CommentSort,
  FeedTab,
  IncidentKind,
  InteractionType,
  ItdErrorCode,
  LikesVisibility,
  NotificationType,
  RealtimeStatus,
  ReportReason,
  ReportTargetType,
  ServiceState,
  SpanType,
  ViewReason,
  ViewSource,
  WallAccess,
} from './types/enums.js';
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
export { REQUEST_OPTION_KEYS } from './types/options.js';
export type {
  CreateCommentInput,
  CreatePollInput,
  CreatePostData,
  CreateReportInput,
  UpdatePostInput,
} from './types/params.js';
