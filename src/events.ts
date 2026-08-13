/**
 * Каналы событий, транспорты и промежуточные обработчики без полного клиента SDK.
 *
 * @packageDocumentation
 */

export {
  type AuthIdentity,
  type AuthProvider,
  anonymousAuth,
  bearerToken,
  tokenProvider,
} from './core/auth-provider.js';
export { type ItdClock, systemClock } from './core/clock.js';
export { DEFAULT_BASE_URL, LIBRARY_VERSION } from './core/config.js';
export type { ClientConnection } from './core/connection.js';
export type { Listener, Unsubscribe } from './core/emitter.js';
export {
  ItdAbortError,
  ItdApiError,
  ItdApiErrorKind,
  ItdAuthError,
  ItdConfigError,
  ItdError,
  ItdErrorKind,
  ItdForbiddenError,
  ItdNetworkError,
  ItdNotFoundError,
  ItdRateLimitError,
  ItdServerError,
  ItdStateError,
  ItdTimeoutError,
  ItdValidationError,
  isItdApiError,
  isItdAuthError,
  isItdError,
  isItdRateLimitError,
  isItdStateError,
  isItdValidationError,
} from './core/errors.js';
export type { ClientHooks, Logger, RuntimeOptions } from './core/options.js';
export { RuntimeMode } from './core/runtime.js';
export {
  createNotificationEventsClient,
  NotificationEventsClient,
  type NotificationEventsClientOptions,
} from './events/client.js';
export {
  EventComposer,
  type EventErrorBoundary,
  type EventErrorContext,
  type EventFilter,
  type EventMiddlewareGroup,
  type EventMiddlewareLike,
  type EventRouteTable,
} from './events/composer.js';
export {
  EventChannel,
  type EventChannelDeps,
  type EventChannelEvents,
  type EventChannelOptions,
  type EventEnqueueOptions,
  type EventSession,
  type EventSyncReason,
  resolveEventChannelOptions,
} from './events/engine.js';
export {
  type EventHandler,
  type EventMiddleware,
  type EventMiddlewareObject,
  type EventNext,
  type EventPredicate,
  type EventSequentializer,
  type EventTypeGuard,
  runEventMiddleware,
} from './events/middleware.js';
export type { ReconnectOptions } from './events/reconnect.js';
export {
  EventRouter,
  type EventRouteSelector,
} from './events/router.js';
export {
  NotificationEvents,
  type NotificationEventsMap,
  type NotificationEventsOptions,
  NotificationEventsTransport,
} from './events/stream.js';
export {
  type EventTransport,
  type EventTransportContext,
  type EventTransportFrame,
  UnauthorizedStreamError,
} from './events/transports/transport.js';
export {
  type WebSocketImplementationOptions,
  type WebSocketLike,
  type WebSocketOpenFailureClassifier,
  WebSocketTransport,
  type WebSocketTransportOptions,
} from './events/transports/websocket.js';
export {
  type EventContext,
  type NotificationContext,
  type NotificationEventContext,
  type NotificationEventFilter,
  type NotificationEventOfType,
  type NotificationEventSelector,
  type NotificationEventsUpdate,
  type NotificationOfType,
  type NotificationUpdate,
  type NotificationUpdateOfType,
  NotificationUpdateOrigin,
  NotificationUpdateType,
  type UnknownNotificationUpdate,
  type UnreadCountUpdate,
} from './events/updates.js';
export type { Notification, NotificationSettings } from './models/notifications.js';
export { type NotificationEvent, normalizeNotification } from './notifications/normalize.js';
export { formatNotificationText } from './notifications/text.js';
export { canonicalNotificationType, isKnownNotificationType } from './notifications/type-map.js';
export { resolveNotificationUrl } from './notifications/url.js';
export type { Loose } from './types/enums.js';
export {
  EventChannelStatus,
  NotificationType,
} from './types/enums.js';
