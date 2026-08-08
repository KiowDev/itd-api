import { ItdConfigError } from '../core/errors.js';
import type { Notification } from '../models/notifications.js';
import type { NotificationEvent } from '../notifications/normalize.js';
import { readNotificationEvent, readUnreadCountEvent } from '../notifications/normalize.js';
import type { NotificationType } from '../types/enums.js';
import type { ItdRealtime } from './stream.js';
import type { TransportEvent } from './transports/transport.js';

/** Типы нормализованных обновлений потока. */
export const RealtimeUpdateType = Object.freeze({
  Notification: 'notification',
  UnreadCount: 'unreadCount',
  Unknown: 'unknown',
} as const);

/** Источники нормализованных обновлений потока. */
export const RealtimeUpdateOrigin = Object.freeze({
  Stream: 'stream',
  Sync: 'sync',
} as const);
export type RealtimeUpdateOrigin = (typeof RealtimeUpdateOrigin)[keyof typeof RealtimeUpdateOrigin];

/** Уведомление с типом, суженным фильтром потока. */
export type NotificationOfType<T extends NotificationType> = Omit<Notification, 'type'> & {
  type: T;
};

/** Конверт уведомления с типом, суженным фильтром потока. */
export type NotificationEventOfType<T extends NotificationType> = Omit<
  NotificationEvent,
  'notification'
> & {
  notification: NotificationOfType<T>;
};

/** Нормализованное уведомление из потока. */
export interface RealtimeNotificationUpdate<T extends NotificationType = NotificationType> {
  readonly type: typeof RealtimeUpdateType.Notification;
  readonly data: NotificationEventOfType<T>;
}

/** Актуальное число непрочитанных уведомлений. */
export interface RealtimeUnreadCountUpdate {
  readonly type: typeof RealtimeUpdateType.UnreadCount;
  readonly data: number;
}

/** Неизвестное библиотеке событие потока. */
export interface RealtimeUnknownUpdate {
  readonly type: typeof RealtimeUpdateType.Unknown;
  readonly name: string;
  readonly data: unknown;
}

/** Данные, проходящие через промежуточные обработчики потока. */
export type RealtimeUpdate =
  | RealtimeNotificationUpdate
  | RealtimeUnreadCountUpdate
  | RealtimeUnknownUpdate;

/** Тип нормализованного обновления потока. */
export type RealtimeUpdateType = RealtimeUpdate['type'];

/** Обновление потока указанного типа. */
export type RealtimeUpdateOfType<T extends RealtimeUpdateType> = Extract<
  RealtimeUpdate,
  { type: T }
>;

/**
 * Общая форма контекста обработки: то, что есть у любого потока независимо от домена.
 *
 * Контекст — обычный объектный литерал, а не класс с геттерами и не `Object.freeze`:
 * плагины-флейворы присваивают в него свои поля (`ctx.session = …`), а `@itd-api/hydrate`
 * подменяет `update` и `stream` через `Object.defineProperty`.
 *
 * @typeParam U нормализованное обновление домена
 * @typeParam S поток, который его получил
 */
export interface RealtimeContextBase<U = unknown, S = unknown> {
  /** Нормализованные данные обновления. */
  readonly update: U;
  /** Поток, который получил обновление. */
  readonly stream: S;
  /** Исходный кадр транспорта. Для начальной REST-синхронизации равен `undefined`. */
  readonly raw: TransportEvent | undefined;
  /** Откуда получены данные. */
  readonly origin: RealtimeUpdateOrigin;
}

/** Контекст обработки одного обновления потока уведомлений. */
export type RealtimeContext<U extends RealtimeUpdate = RealtimeUpdate> = RealtimeContextBase<
  U,
  ItdRealtime
>;

/** Контекст уведомления с типом, суженным фильтром. */
export type RealtimeNotificationContext<T extends NotificationType = NotificationType> =
  RealtimeContext<RealtimeNotificationUpdate<T>>;

/** Условия отбора уведомлений. Все указанные поля объединяются через логическое И. */
export interface RealtimeNotificationFilter<T extends NotificationType = NotificationType> {
  /** Один или несколько канонических типов уведомления. */
  type?: T | readonly T[];
  /** Идентификатор хотя бы одного участника уведомления. */
  actorId?: string;
  /** Идентификатор объекта события. */
  entityId?: string | null;
  /** Идентификатор родительского объекта. */
  parentEntityId?: string | null;
  /** Дополнительная проверка после сопоставления полей. */
  predicate?: (context: RealtimeNotificationContext<T>) => boolean;
}

/** Краткая или объектная форма фильтра уведомлений. */
export type RealtimeNotificationSelector<T extends NotificationType = NotificationType> =
  | T
  | readonly T[]
  | RealtimeNotificationFilter<T>;

/** Проверяет форму фильтра уведомлений. */
export function validateNotificationSelector(selector: unknown): void {
  if (typeof selector === 'string') {
    if (selector.length === 0) throw new ItdConfigError('Тип уведомления не должен быть пустым');
    return;
  }

  if (Array.isArray(selector)) {
    if (selector.length === 0 || selector.some((type) => typeof type !== 'string' || !type)) {
      throw new ItdConfigError('Список типов уведомлений должен содержать непустые строки');
    }
    return;
  }

  if (typeof selector !== 'object' || selector === null) {
    throw new ItdConfigError('Фильтр уведомлений должен быть строкой, списком или объектом');
  }

  const filter = selector as Record<string, unknown>;
  if (filter.type !== undefined) validateNotificationSelector(filter.type);
  if (filter.actorId !== undefined && typeof filter.actorId !== 'string') {
    throw new ItdConfigError('Фильтр уведомлений: actorId должен быть строкой');
  }
  for (const field of ['entityId', 'parentEntityId'] as const) {
    const value = filter[field];
    if (value !== undefined && value !== null && typeof value !== 'string') {
      throw new ItdConfigError(`Фильтр уведомлений: ${field} должен быть строкой или null`);
    }
  }
  if (filter.predicate !== undefined && typeof filter.predicate !== 'function') {
    throw new ItdConfigError('Фильтр уведомлений: predicate должен быть функцией');
  }
}

/** Преобразует транспортный кадр в одно логическое обновление. */
export function readRealtimeUpdate(event: TransportEvent): RealtimeUpdate | undefined {
  if (event.name === 'notification') {
    return {
      type: RealtimeUpdateType.Notification,
      data: readNotificationEvent(event.data),
    };
  }

  if (event.name === 'unread_count') {
    const count = readUnreadCountEvent(event.data);
    return count === undefined ? undefined : { type: RealtimeUpdateType.UnreadCount, data: count };
  }

  return { type: RealtimeUpdateType.Unknown, name: event.name, data: event.data };
}

/** Проверяет объектный или краткий фильтр уведомления. */
export function matchesNotification<T extends NotificationType>(
  context: RealtimeNotificationContext,
  selector: RealtimeNotificationSelector<T>,
): context is RealtimeNotificationContext<T> {
  const notification = context.update.data.notification;

  if (typeof selector === 'string') return notification.type === selector;
  if (Array.isArray(selector)) return selector.includes(notification.type as T);

  const filter = selector as RealtimeNotificationFilter<T>;
  const types = filter.type === undefined ? undefined : [filter.type].flat();

  if (types && !types.includes(notification.type as T)) return false;
  if (
    filter.actorId !== undefined &&
    !notification.actors.some(({ id }) => id === filter.actorId)
  ) {
    return false;
  }
  if (filter.entityId !== undefined && notification.entityId !== filter.entityId) return false;
  if (
    filter.parentEntityId !== undefined &&
    notification.parentEntityId !== filter.parentEntityId
  ) {
    return false;
  }

  return filter.predicate?.(context as RealtimeNotificationContext<T>) ?? true;
}

/** Сужает произвольный контекст потока до контекста уведомления. */
export function isNotificationContext(
  context: RealtimeContext,
): context is RealtimeNotificationContext {
  return context.update.type === RealtimeUpdateType.Notification;
}
