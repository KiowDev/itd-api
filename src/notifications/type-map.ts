import { NotificationType } from '../types/enums.js';

/**
 * Соответствие коротких имён типов уведомлений развёрнутым.
 *
 * Сервер — и в списке, и в потоке событий — присылает короткие имена: `like`, `comment`,
 * `reply`, `repost`, `comment_like`. Развёрнутые (`post_reaction`, `post_comment`)
 * встречаются в оформлении интерфейса, поэтому библиотека приводит типы к ним:
 * они однозначно называют и объект, и действие.
 *
 * Пришедшее значение всегда остаётся в поле `rawType`.
 */
export const NOTIFICATION_TYPE_ALIASES: Readonly<Record<string, NotificationType>> = Object.freeze({
  like: NotificationType.PostReaction,
  comment: NotificationType.PostComment,
  comment_like: NotificationType.CommentReaction,
  reply: NotificationType.CommentReply,
  repost: NotificationType.PostRepost,
  mention: NotificationType.PostMention,
});

const KNOWN_TYPES = new Set<string>(Object.values(NotificationType));

/**
 * Приводит имя типа к каноническому.
 *
 * Неизвестное значение возвращается без изменений. Официальный клиент в этом случае
 * подставляет `follow`, из-за чего новое уведомление выглядит как подписка, — здесь
 * такого не происходит.
 *
 * @example
 * ```ts
 * canonicalNotificationType('like');           // 'post_reaction'
 * canonicalNotificationType('post_reaction');  // 'post_reaction'
 * canonicalNotificationType('новое_событие');  // 'новое_событие'
 * ```
 */
export function canonicalNotificationType(rawType: string): NotificationType {
  return NOTIFICATION_TYPE_ALIASES[rawType] ?? rawType;
}

/**
 * Известен ли библиотеке этот тип уведомления.
 *
 * Полезно, чтобы решить, показывать ли уведомление, для которого нет своего оформления.
 */
export function isKnownNotificationType(type: string): boolean {
  return KNOWN_TYPES.has(canonicalNotificationType(type));
}
