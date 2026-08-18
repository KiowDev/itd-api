/**
 * `itd-api` — клиент REST API и событий социальной сети итд.com.
 *
 * @packageDocumentation
 */

// Несколько аккаунтов в одном контейнере: у каждого свой токен, cookie и deviceId,
// а сессии складываются в одно хранилище. Подробности — в accounts.ts.
export type {
  AccountEvents,
  AccountFeature,
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
export type {
  FileResolver,
  PreparedBufferSource,
  PreparedFileSource,
  PreparedStreamSource,
  ResolveFileContext,
  ResolveFileOptions,
} from './core/attachments/resolver.js';
export type { AuthIdentity, AuthProvider } from './core/auth-provider.js';
export { type ItdClock, systemClock } from './core/clock.js';
export { DEFAULT_BASE_URL, LIBRARY_VERSION, STATUS_SERVICE } from './core/config.js';
export type { ClientConnection } from './core/connection.js';
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
export type {
  ClientFeature,
  FeatureBucketDefinition,
  FeatureContext,
  FeatureInstallation,
  FeatureOperationDefinition,
  FeatureRequestOptions,
} from './core/features.js';
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
export type { ManagedClientResource } from './core/managed-resources.js';
export {
  type FeatureOperationId,
  type OperationAnnotations,
  type OperationMetadata,
  type OperationMethod,
  RetrySafety,
} from './core/operation.js';
// Опции разделены по слоям: RuntimeOptions нужны generic-ядру, SessionOptions — сессии,
// а ItdClientOptions объединяет их для полного SDK. Подробности — в core/options.ts.
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
// Плагины расширяют два явных уровня: logical operation и отдельную transport attempt.
// Публичные контракты отделены от registry и порядка установки.
export type {
  AttemptContext,
  AttemptExtensions,
  AttemptInterceptor,
  AttemptNext,
  ClientPlugin,
  OperationExtensions,
  OperationTransformContext,
  OperationTransformer,
  PluginApi,
  PluginTeardown,
} from './core/plugins/contracts.js';
export { RuntimeMode } from './core/runtime.js';
export { RateLimitPacing } from './core/scheduling/pacing.js';
export type { RateLimitBucketState } from './core/scheduling/rate-limit.js';
// Сервисы — домены платформы, отличные от основного. Подробности — в core/services.ts.
export type { ServiceDefinition } from './core/services.js';
export type { QueryParams, QueryValue } from './core/url.js';
// Каталог операций и таблица счётчиков частоты — знание о самом API итд.com, а не о механике
// исполнения запроса. Ядро получает их через контракт каталога. Подробности — в domain/catalog.ts.
export {
  BUCKET_LIMITS,
  DEFAULT_RATE_LIMIT_BUCKET,
  type RateLimitBucket,
} from './domain/buckets.js';
export {
  ALLOWED_MIME_TYPES,
  type AllowedMimeType,
  AUDIO_MIME_TYPES,
  type AudioMimeType,
  IMAGE_MIME_TYPES,
  type ImageMimeType,
  VIDEO_MIME_TYPES,
  type VideoMimeType,
} from './domain/mime.js';
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
export { toDate, utcStampToIso } from './domain/time.js';
export type { ReconnectOptions } from './events/reconnect.js';
export {
  type WebSocketImplementationOptions,
  type WebSocketLike,
  type WebSocketOpenFailureClassifier,
  WebSocketTransport,
  type WebSocketTransportOptions,
} from './events/transports/websocket.js';
export type {
  NotificationEventOfType,
  NotificationOfType,
} from './events/updates.js';
export {
  createNotificationEventsClient,
  EventChannel,
  type EventChannelDeps,
  type EventChannelEvents,
  type EventChannelOptions,
  EventChannelStatus,
  EventComposer,
  type EventContext,
  type EventEnqueueOptions,
  type EventErrorBoundary,
  type EventErrorContext,
  type EventFilter,
  type EventHandler,
  type EventMiddleware,
  type EventMiddlewareGroup,
  type EventMiddlewareLike,
  type EventMiddlewareObject,
  type EventNext,
  type EventPredicate,
  EventRouter,
  type EventRouteSelector,
  type EventRouteTable,
  type EventSequentializer,
  type EventSession,
  type EventSyncReason,
  type EventTransport,
  type EventTransportContext,
  type EventTransportFrame,
  type EventTypeGuard,
  type NotificationContext,
  type NotificationEventContext,
  type NotificationEventFilter,
  type NotificationEventSelector,
  NotificationEvents,
  NotificationEventsClient,
  type NotificationEventsClientOptions,
  type NotificationEventsMap,
  type NotificationEventsOptions,
  NotificationEventsTransport,
  type NotificationEventsUpdate,
  type NotificationUpdate,
  type NotificationUpdateOfType,
  NotificationUpdateOrigin,
  NotificationUpdateType,
  runEventMiddleware,
  UnauthorizedStreamError,
  type UnknownNotificationUpdate,
  type UnreadCountUpdate,
} from './events.js';
export type { PaymentMethod, Session, Subscription } from './models/account.js';
export type { IsoDate, Span, UserId, UserRef } from './models/common.js';
export type {
  Attachment,
  Comment,
  CommentReplyTo,
  CommentUpdateResult,
  Hashtag,
  LikeResult,
  PinPostResult,
  Poll,
  PollOption,
  Post,
  PostStats,
  PostUpdateResult,
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
export {
  type CreateShopOrderInput,
  type ShopConsent,
  type ShopConsentContext,
  ShopConsentKind,
  type ShopCreatedOrder,
  type ShopDeliveryCalculation,
  type ShopDeliveryCity,
  type ShopDeliveryCountry,
  type ShopDeliveryDestination,
  type ShopDeliveryPoint,
  type ShopOrder,
  type ShopOrderAccessSession,
  type ShopOrderAccessVerification,
  type ShopOrderDelivery,
  type ShopOrderItem,
  type ShopOrderItemInput,
  ShopOrderStatus,
  type ShopOrderSummary,
  type ShopOrderSupport,
  type ShopPayment,
  type ShopProduct,
  ShopProductCategory,
  type ShopProductColor,
  type ShopProductSpec,
  ShopProductStatus,
  type ShopRecipient,
  type ShopSizeChart,
  type ShopSizeChartRow,
} from './models/shop.js';
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
  AuthUser,
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
export type { NotificationsApi } from './notifications-api.js';
export type { ItdClientOptions } from './options.js';
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
export type { Page, PageState, PaginatorOptions } from './resources/pagination.js';
export { mapPage, PaginationMode, Paginator } from './resources/pagination.js';
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
export type {
  CreateShopOrderOptions,
  PayShopOrderOptions,
  ShopConsentsResource,
  ShopDeliveryResource,
  ShopOrderRequestOptions,
  ShopOrdersResource,
  ShopProductsResource,
  ShopResource,
} from './resources/shop.js';
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
export { type AuthEvents, TURNSTILE_SITE_KEY } from './session/auth.js';
// Хранилище на несколько аккаунтов: те же операции, но с именем аккаунта в каждой.
// Подробности — в core/multi-storage.ts.
export {
  createMultiTokenStorage,
  MemoryMultiTokenStorage,
  type MultiTokenStorage,
  type MultiTokenStorageAdapterOptions,
  scopedTokenStorage,
} from './session/multi-storage.js';
export type { AuthInput, CredentialsAuth, SessionOptions } from './session/options.js';
// Платформенные хранилища живут в своих точках входа: `FileTokenStorage` требует `node:fs`
// и потому не может попасть в нейтральный бандл, а Web Storage backend вынесены
// в `itd-api/web`, чтобы их молчаливый откат в память выбирали осознанно.
export {
  createTokenStorage,
  type ItdSession,
  MemoryTokenStorage,
  type TokenStorage,
  type TokenStorageAdapterOptions,
} from './session/storage.js';
export {
  createShopFeature,
  type ShopFeatureApi,
  type ShopFeatureOptions,
} from './shop/feature.js';
export {
  createShopOrderAccessStorage,
  MemoryShopOrderAccessStorage,
  type ShopOrderAccessStorage,
  type ShopOrderAccessStorageAdapterOptions,
} from './shop/order-access.js';
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
// Enum экспортируются парой «значение + тип» под одним именем:
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
  ReportReason,
  ReportTargetType,
  ServiceState,
  SpanType,
  ViewReason,
  ViewSource,
  WallAccess,
} from './types/enums.js';
