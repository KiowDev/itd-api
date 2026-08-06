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
  type FileContent,
  type FileContext,
  type FileInput,
  type FileStreamContent,
  type FileStreamOptions,
  FileTransferMode,
  type FromStreamOptions,
  type LazyFile,
  type StreamFile,
  type UrlFile,
  type UrlFileOptions,
} from './core/attachments/contracts.js';
export { fromStream, fromUrl } from './core/attachments/factories.js';
export { type AuthEvents, type AuthIdentity, TURNSTILE_SITE_KEY } from './core/auth.js';
export {
  BUCKET_LIMITS,
  DEFAULT_RATE_LIMIT_BUCKET,
  type RateLimitBucket,
  RateLimitPacing,
} from './core/buckets.js';
export { type ItdClock, systemClock } from './core/clock.js';
export { DEFAULT_BASE_URL, LIBRARY_VERSION, STATUS_SERVICE } from './core/config.js';
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
  ItdStateError,
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
  isItdStateError,
  isItdValidationError,
} from './core/errors.js';
export {
  createKeyValueStore,
  createRecordKeyValueStore,
  type EnumerableKeyValueStore,
  isEnumerableKeyValueStore,
  type KeyValueCodec,
  type KeyValueStore,
  type KeyValueStoreKeys,
  type KeyValueStoreResult,
  MemoryKeyValueStore,
  type RecordKeyValueStoreSource,
  withCodec,
  withNamespace,
} from './core/key-value-store.js';
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
  MemoryMultiTokenStorage,
  type MultiTokenStorage,
  type MultiTokenStorageAdapterOptions,
  scopedTokenStorage,
} from './core/multi-storage.js';
export {
  type BuiltInOperationId,
  type CustomOperationId,
  isBuiltInOperationId,
  OPERATIONS,
  type OperationDefinition,
  type OperationId,
  type OperationMethod,
  operationBucket,
  operationMethod,
  operationRetrySafety,
  RetrySafety,
} from './core/operations.js';
export type { Page, PageState, PaginatorOptions } from './core/pagination.js';
export { mapPage, PaginationMode, Paginator } from './core/pagination.js';
// Плагины расширяют два явных уровня: logical operation и отдельную transport attempt.
// Публичные контракты отделены от registry и порядка установки.
export type {
  AttemptContext,
  AttemptExtensions,
  AttemptInterceptor,
  AttemptNext,
  ClientPlugin,
  OperationExtensions,
  OperationTransformer,
  PluginApi,
  PluginTeardown,
} from './core/plugins/contracts.js';
export type { RateLimitBucketState } from './core/rate-limit.js';
export { RuntimeMode } from './core/runtime.js';
// Сервисы — домены платформы, отличные от основного. Подробности — в core/services.ts.
export type { ServiceDefinition } from './core/services.js';
// Платформенные хранилища живут в своих точках входа: `FileTokenStorage` требует `node:fs`
// и потому не может попасть в нейтральный бандл, а Web Storage backend вынесены
// в `itd-api/web`, чтобы их молчаливый откат в память выбирали осознанно.
export {
  createTokenStorage,
  type ItdSession,
  MemoryTokenStorage,
  type TokenStorage,
  type TokenStorageAdapterOptions,
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
export { type NotificationEvent, normalizeNotification } from './notifications/normalize.js';
export { formatNotificationText } from './notifications/text.js';
export { canonicalNotificationType, isKnownNotificationType } from './notifications/type-map.js';
export { resolveNotificationUrl } from './notifications/url.js';
export {
  RealtimeComposer,
  type RealtimeErrorBoundary,
  type RealtimeErrorContext,
  type RealtimeFilter,
  type RealtimeMiddlewareGroup,
  type RealtimeMiddlewareLike,
  type RealtimeRouteTable,
} from './realtime/composer.js';
export type { RealtimeEngineEvents } from './realtime/engine.js';
export {
  type RealtimeHandler,
  type RealtimeMiddleware,
  type RealtimeMiddlewareObj,
  type RealtimeNext,
  type RealtimePredicate,
  type RealtimeSequentializer,
  type RealtimeTypeGuard,
  runRealtimeMiddleware,
} from './realtime/middleware.js';
export type { ReconnectOptions } from './realtime/reconnect.js';
export { RealtimeRouter, type RealtimeRouteSelector } from './realtime/router.js';
export {
  ItdRealtime,
  type RealtimeEvents,
  type RealtimeOptions,
  RealtimeTransportKind,
} from './realtime/stream.js';
export type {
  RealtimeRequest,
  RealtimeRequestInput,
  RealtimeTransport,
  TransportContext,
  TransportEvent,
} from './realtime/transport.js';
// Нужен тем, кто пишет свой транспорт: только этой ошибкой он сообщает потоку,
// что токен пора обновить.
export { UnauthorizedStreamError } from './realtime/transport.js';
export {
  type NotificationEventOfType,
  type NotificationOfType,
  type RealtimeContext,
  type RealtimeContextBase,
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
export {
  type WebSocketImplementationOptions,
  type WebSocketLike,
  type WebSocketOpenFailureClassifier,
  WebSocketTransport,
  type WebSocketTransportOptions,
} from './realtime/websocket.js';
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
export type {
  FilesResource,
  UploadedFile,
  UploadOptions,
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
  OperationRequestOptions,
  PaginationOptions,
  RateLimitBucketContext,
  RateLimitBucketOverride,
  RateLimitOptions,
  RawRequestOptions,
  RequestContext,
  RequestExtensions,
  RequestOptions,
  ResponseContext,
  RetryContext,
  RetryDecisionContext,
  RetryOptions,
} from './types/options.js';
export type {
  CreateCommentInput,
  CreatePollInput,
  CreatePostData,
  CreateReportInput,
  UpdatePostInput,
} from './types/params.js';
