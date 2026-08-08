/**
 * `itd-api/rest` — минимальный клиент REST API итд.com.
 *
 * Тот же конвейер запросов, что и у полного `ItdClient`: повторы, очередь по серверным
 * счётчикам частоты, плагины, типизированные ошибки. Без сессии, потока событий
 * и контейнера аккаунтов — их сюда не затянуть даже случайно, границу сторожит
 * `scripts/check-imports.mjs`.
 *
 * @example
 * ```ts
 * import { createRestClient } from 'itd-api/rest';
 *
 * const api = createRestClient({ auth: process.env.ITD_TOKEN });
 * for await (const post of api.posts.iterate({ tab: 'popular' })) {
 *   console.log(post.content);
 * }
 * ```
 *
 * @packageDocumentation
 */

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
// Авторизация здесь — готовый токен, а не сессия: продлевать его клиент не умеет.
// Вход по паролю, refresh и хранилище живут в полном `ItdClient`.
export {
  type AuthProvider,
  anonymousAuth,
  bearerToken,
  tokenProvider,
} from './core/auth-provider.js';
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
  ALLOWED_MIME_TYPES,
  type AllowedMimeType,
  AUDIO_MIME_TYPES,
  type AudioMimeType,
  IMAGE_MIME_TYPES,
  type ImageMimeType,
  VIDEO_MIME_TYPES,
  type VideoMimeType,
} from './core/mime.js';
export { type OperationMethod, RetrySafety } from './core/operation.js';
export type {
  ClientHooks,
  ErrorContextHook,
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
  RuntimeOptions,
} from './core/options.js';
export { RateLimitPacing } from './core/pacing.js';
export type { Page, PageState, PaginatorOptions } from './core/pagination.js';
export { mapPage, PaginationMode, Paginator } from './core/pagination.js';
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
export type { ServiceDefinition } from './core/services.js';
export { toDate, utcStampToIso } from './core/time.js';
export type { QueryParams, QueryValue } from './core/url.js';
export {
  BUCKET_LIMITS,
  DEFAULT_RATE_LIMIT_BUCKET,
  type RateLimitBucket,
} from './domain/buckets.js';
export {
  type BuiltInOperationId,
  type CustomOperationId,
  type ItdOperationDefinition as OperationDefinition,
  isBuiltInOperationId,
  OPERATIONS,
  type OperationId,
  operationBucket,
  operationMethod,
  operationRetrySafety,
} from './domain/operations.js';
export type {
  CreateCommentInput,
  CreatePollInput,
  CreatePostData,
  CreateReportInput,
  UpdatePostInput,
} from './domain/params.js';
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
export { type NotificationEvent, normalizeNotification } from './notifications/normalize.js';
export { formatNotificationText } from './notifications/text.js';
export { canonicalNotificationType, isKnownNotificationType } from './notifications/type-map.js';
export { resolveNotificationUrl } from './notifications/url.js';
export type { CommentsResource, RepliesParams } from './resources/comments.js';
export type { FilesResource, UploadedFile, UploadOptions } from './resources/files.js';
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
export { createRestClient, ItdRestClient, type RestClientOptions } from './rest/client.js';
export {
  type ParseMarkupOptions,
  parseHtml,
  parseMarkdown,
} from './spans/parse.js';
export { type RenderSpansOptions, renderSpans, SpanRenderFormat } from './spans/render.js';
export type { Loose } from './types/enums.js';
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
  ReportReason,
  ReportTargetType,
  ServiceState,
  SpanType,
  ViewReason,
  ViewSource,
  WallAccess,
} from './types/enums.js';
