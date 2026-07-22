import { asString, isRecord } from '../core/unwrap.js';
import type { Actor, Notification } from '../types/models.js';
import { canonicalNotificationType } from './type-map.js';

/** Событие потока уведомлений после разбора. */
export interface NotificationEvent {
  /** Само уведомление в единой форме. */
  notification: Notification;
  /**
   * Актуальное число непрочитанных, если сервер его сообщил.
   *
   * Клиент не увеличивает счётчик сам: значение приходит с сервера.
   */
  unreadCount: number | undefined;
  /** Нужно ли проиграть звук. */
  sound: boolean;
}

function asActor(value: unknown): Actor | undefined {
  if (!isRecord(value)) return undefined;
  const id = asString(value.id);
  if (!id) return undefined;

  return {
    id,
    username: asString(value.username) ?? '',
    displayName: asString(value.displayName) ?? '',
    avatar: asString(value.avatar) ?? '',
    ...(typeof value.isFollowing === 'boolean' ? { isFollowing: value.isFollowing } : {}),
    ...(typeof value.isFollowedBy === 'boolean' ? { isFollowedBy: value.isFollowedBy } : {}),
  };
}

/** Собирает участников: сервер присылает либо одного `actor`, либо массив `actors`. */
function readActors(source: Record<string, unknown>): Actor[] {
  if (Array.isArray(source.actors)) {
    return source.actors.map(asActor).filter((actor): actor is Actor => actor !== undefined);
  }

  const single = asActor(source.actor);
  return single ? [single] : [];
}

/**
 * Приводит уведомление к единой форме.
 *
 * Нужна потому, что REST-список и поток событий описывают одно и то же событие по-разному:
 * различаются имена типов (`like` против `post_reaction`), имена полей
 * (`targetId`/`entityId`, `read`/`isRead`, `preview`/`entityPreview`) и число участников
 * (`actor` против массива `actors`). После приведения объекты из обоих источников
 * можно складывать в один список.
 *
 * Исходные данные не теряются: имя типа с сервера остаётся в `rawType`,
 * весь объект целиком — в `raw`.
 *
 * @param input уведомление из REST-ответа либо полезная нагрузка события потока
 *
 * @example
 * ```ts
 * const fromRest = normalizeNotification(restItem);
 * const fromStream = normalizeNotification(event.payload);
 * // одинаковая форма — можно объединять
 * ```
 */
export function normalizeNotification(input: unknown): Notification {
  const source = isRecord(input) ? input : {};

  // Поток кладёт полезную нагрузку то в payload, то прямо в корень события.
  const payload = isRecord(source.payload) ? source.payload : source;

  const rawType = asString(payload.type) ?? asString(source.type) ?? '';
  const createdAt = asString(payload.createdAt) ?? asString(source.createdAt) ?? '';
  const readAt = asString(payload.readAt) ?? asString(source.readAt);

  const isRead =
    typeof payload.isRead === 'boolean'
      ? payload.isRead
      : typeof payload.read === 'boolean'
        ? payload.read
        : Boolean(readAt);

  // Сервер описывает событие парой «цель — предмет», и смысл пары зависит от типа:
  //
  //   комментарий, реакция на него — цель = пост, предмет = комментарий
  //   репост                       — цель = сам репост, предмет = исходный пост
  //   реакция на пост, подписка    — предмета нет
  //
  // Событие относится к предмету, только когда тот является комментарием; иначе объект
  // события — цель. Без этого различия ссылка на репост вела бы на чужой исходный пост.
  const subjectId = asString(payload.subjectId);
  const targetId = asString(payload.targetId);
  const subjectIsComment = payload.subjectType === 'comment';
  const clickUrl = asString(payload.clickUrl);

  return {
    id: asString(payload.id) ?? asString(source.id) ?? '',
    type: canonicalNotificationType(rawType),
    rawType,
    entityId:
      asString(payload.entityId) ?? (subjectIsComment ? (subjectId ?? targetId) : targetId) ?? null,
    parentEntityId:
      asString(payload.parentEntityId) ?? (subjectIsComment ? (targetId ?? null) : null),
    isRead,
    actors: readActors(payload),
    count: typeof payload.count === 'number' && payload.count > 0 ? payload.count : 1,
    preview: asString(payload.entityPreview) ?? asString(payload.preview) ?? null,
    ...(clickUrl ? { clickUrl } : {}),
    createdAt,
    updatedAt: asString(payload.updatedAt) ?? readAt ?? createdAt,
    raw: input,
  };
}

/**
 * Разбирает событие `notification` из потока.
 *
 * Кроме самого уведомления событие несёт служебные поля уровня конверта: актуальный
 * счётчик непрочитанных и признак звука.
 */
export function readNotificationEvent(data: unknown): NotificationEvent {
  const source = isRecord(data) ? data : {};

  return {
    notification: normalizeNotification(data),
    unreadCount: typeof source.unreadCount === 'number' ? source.unreadCount : undefined,
    sound: source.sound === true,
  };
}

/**
 * Разбирает событие `unread_count` из потока.
 *
 * Возвращает `undefined`, если сервер прислал событие без вложенного `payload`.
 * Официальный клиент в этом случае **обнуляет** счётчик — это ошибка, из-за которой
 * непрочитанные пропадают из интерфейса.
 */
export function readUnreadCountEvent(data: unknown): number | undefined {
  if (!isRecord(data)) return undefined;

  const payload = isRecord(data.payload) ? data.payload : undefined;
  if (!payload) return undefined;

  return typeof payload.count === 'number' ? payload.count : undefined;
}
