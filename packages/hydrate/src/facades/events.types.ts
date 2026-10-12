import type {
  EventHandler,
  EventMiddleware,
  EventMiddlewareObject,
  EventNext,
  Listener,
  NotificationContext,
  NotificationEvent,
  NotificationEventContext,
  NotificationEventFilter,
  NotificationEvents,
  NotificationEventsMap,
  NotificationType,
  NotificationUpdate,
  NotificationUpdateOfType,
  NotificationUpdateType,
  Unsubscribe,
} from 'itd-api';
import type { Hydrated } from '../shapes/shape.types.js';
import type { NOTIFICATION_EVENT_SHAPE, NOTIFICATION_UPDATE_SHAPE } from './events.constants.js';

/** Событие уведомления с гидратированной моделью. */
export type HydratedNotificationEvent = Hydrated<
  NotificationEvent,
  typeof NOTIFICATION_EVENT_SHAPE
>;

type HydratedUpdate<U> = U extends NotificationUpdate
  ? Hydrated<U, typeof NOTIFICATION_UPDATE_SHAPE>
  : U;

/** Контекст события с гидратированным обновлением и каналом. */
export type HydratedEventContext<C extends NotificationEventContext = NotificationEventContext> =
  Omit<C, 'update' | 'stream'> & {
    readonly update: HydratedUpdate<C['update']>;
    readonly stream: HydratedNotificationEvents;
  };

/** Контекст уведомления с типом, суженным селектором. */
export type HydratedNotificationContext<T extends NotificationType = NotificationType> =
  HydratedEventContext<NotificationContext<T>>;

/** Асинхронный обработчик гидратированного обновления. */
export type HydratedEventHandler<C extends NotificationEventContext = NotificationEventContext> = (
  context: HydratedEventContext<C>,
) => ReturnType<EventHandler<C>>;

/** Промежуточный обработчик гидратированных обновлений. */
export type HydratedEventMiddleware<C extends NotificationEventContext = NotificationEventContext> =
  (context: HydratedEventContext<C>, next: EventNext) => ReturnType<EventMiddleware<C>>;

/** Условия отбора гидратированных уведомлений. */
export type HydratedNotificationFilter<T extends NotificationType = NotificationType> = Omit<
  NotificationEventFilter<T>,
  'predicate'
> & {
  predicate?: (context: HydratedNotificationContext<T>) => boolean;
};

/** Краткая или объектная форма фильтра гидратированных уведомлений. */
export type HydratedNotificationSelector<T extends NotificationType = NotificationType> =
  | T
  | readonly T[]
  | HydratedNotificationFilter<T>;

/** Значение события гидратированного потока. */
export type HydratedNotificationEventsEvent<K extends keyof NotificationEventsMap> =
  K extends 'notification'
    ? HydratedNotificationEvent
    : K extends 'middlewareError' | 'handlerError'
      ? NotificationEventsMap[K] extends infer Event extends { context: NotificationEventContext }
        ? Omit<Event, 'context'> & { context: HydratedEventContext<Event['context']> }
        : never
      : NotificationEventsMap[K];

/** Поток, передающий гидратированные уведомления и контексты. */
export type HydratedNotificationEvents = {
  on<K extends keyof NotificationEventsMap>(
    event: K,
    listener: Listener<HydratedNotificationEventsEvent<K>>,
  ): Unsubscribe;
  once<K extends keyof NotificationEventsMap>(
    event: K,
    listener: Listener<HydratedNotificationEventsEvent<K>>,
  ): Unsubscribe;
  use(
    middleware: HydratedEventMiddleware | EventMiddlewareObject<HydratedEventContext>,
  ): Unsubscribe;
  onUpdate(handler: HydratedEventHandler): Unsubscribe;
  onUpdate<T extends NotificationUpdateType>(
    type: T,
    handler: HydratedEventHandler<NotificationEventContext<NotificationUpdateOfType<T>>>,
  ): Unsubscribe;
  onUpdate<C extends NotificationEventContext>(
    guard: (context: HydratedEventContext) => context is HydratedEventContext<C>,
    handler: HydratedEventHandler<C>,
  ): Unsubscribe;
  onUpdate(
    predicate: (context: HydratedEventContext) => boolean,
    handler: HydratedEventHandler,
  ): Unsubscribe;
  onNotification<T extends NotificationType>(
    selector: HydratedNotificationSelector<T>,
    handler: HydratedEventHandler<NotificationEventContext<NotificationUpdate<T>>>,
  ): Unsubscribe;
  onNotification<C extends NotificationContext>(
    guard: (context: HydratedNotificationContext) => context is HydratedEventContext<C>,
    handler: HydratedEventHandler<C>,
  ): Unsubscribe;
  onNotification(
    predicate: (context: HydratedNotificationContext) => boolean,
    handler: HydratedEventHandler<NotificationContext>,
  ): Unsubscribe;
} & NotificationEvents;
