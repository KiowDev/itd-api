/**
 * `itd-api/realtime` — поток уведомлений итд.com без остального SDK.
 *
 * Поток событий с переподключением, запасным опросом и middleware, но без ресурсов,
 * билдеров, разметки и сессии. Нужен приложениям, которым от API нужны только события:
 * виджетам, счётчикам непрочитанного, фоновым слушателям.
 *
 * @example
 * ```ts
 * import { createRealtimeClient } from 'itd-api/realtime';
 *
 * await using stream = createRealtimeClient({ auth: process.env.ITD_TOKEN });
 * stream.on('notification', ({ notification }) => console.log(notification.type));
 * stream.on('unreadCount', (count) => console.log(count));
 * await stream.connect();
 * ```
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
} from './core/errors.js';
export type { ClientHooks, Logger, RuntimeOptions } from './core/options.js';
export { RuntimeMode } from './core/runtime.js';
export type { Notification, NotificationSettings } from './models/notifications.js';
export { type NotificationEvent, normalizeNotification } from './notifications/normalize.js';
export { formatNotificationText } from './notifications/text.js';
export { canonicalNotificationType, isKnownNotificationType } from './notifications/type-map.js';
export { resolveNotificationUrl } from './notifications/url.js';
export {
  createRealtimeClient,
  ItdRealtimeClient,
  type RealtimeClientOptions,
} from './realtime/client.js';
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
export {
  type RealtimeRequest,
  type RealtimeRequestInput,
  type RealtimeTransport,
  type TransportContext,
  type TransportEvent,
  UnauthorizedStreamError,
} from './realtime/transports/transport.js';
export {
  type WebSocketImplementationOptions,
  type WebSocketLike,
  type WebSocketOpenFailureClassifier,
  WebSocketTransport,
  type WebSocketTransportOptions,
} from './realtime/transports/websocket.js';
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
export type { Loose } from './types/enums.js';
export { NotificationType, RealtimeStatus } from './types/enums.js';
