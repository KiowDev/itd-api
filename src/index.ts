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
export { DEFAULT_BASE_URL, DEFAULT_TIMEOUT } from './core/config.js';
export type { Listener, Unsubscribe } from './core/emitter.js';
export {
  ItdAbortError,
  ItdApiError,
  type ItdApiErrorInit,
  ItdAuthError,
  ItdConfigError,
  ItdConflictError,
  ItdError,
  type ItdErrorKind,
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
  isItdError,
  isItdRateLimitError,
  isItdValidationError,
} from './core/errors.js';
export {
  ALLOWED_MIME_TYPES,
  AUDIO_MIME_TYPES,
  IMAGE_MIME_TYPES,
  VIDEO_MIME_TYPES,
} from './core/mime.js';
export type { Page, PageState, PaginationMode } from './core/pagination.js';
export { Paginator } from './core/pagination.js';
export type { RuntimeMode } from './core/runtime.js';
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
  type RealtimeTransportKind,
} from './realtime/stream.js';
export type { RealtimeTransport, TransportContext, TransportEvent } from './realtime/transport.js';
export type {
  AuthResource,
  Credentials,
  OAuthProvider,
  SignInResult,
} from './resources/auth.js';
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
