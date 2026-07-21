import { NotificationType } from '../types/enums.js';
import type { Notification } from '../types/models.js';

/** Имя, которое подставляется, если участник неизвестен. */
const UNKNOWN_ACTOR = 'Пользователь';

/** Текст, который подставляется для неизвестного типа уведомления. */
const FALLBACK_TEXT = 'Новое уведомление';

/**
 * Шаблоны текстов уведомлений.
 *
 * Для каждого типа задано две формы: для одного участника и для схлопнутого уведомления,
 * где действие совершили несколько человек.
 */
const TEMPLATES: Readonly<
  Record<string, { one: (name: string) => string; many: (name: string, others: number) => string }>
> = Object.freeze({
  [NotificationType.Follow]: {
    one: (name) => `${name} подписался(-ась) на вас`,
    many: (name, others) => `${name} и ещё ${others} подписались на вас`,
  },
  [NotificationType.FollowRequest]: {
    one: (name) => `${name} хочет подписаться на вас`,
    many: (name, others) => `${name} и ещё ${others} хотят подписаться на вас`,
  },
  [NotificationType.FollowAccepted]: {
    one: (name) => `${name} принял(а) вашу заявку`,
    many: (name, others) => `${name} и ещё ${others} приняли вашу заявку`,
  },
  [NotificationType.PostReaction]: {
    one: (name) => `${name} оценил(а) ваш пост`,
    many: (name, others) => `${name} и ещё ${others} оценили ваш пост`,
  },
  [NotificationType.PostComment]: {
    one: (name) => `${name} прокомментировал(а) ваш пост`,
    many: (name, others) => `${name} и ещё ${others} прокомментировали ваш пост`,
  },
  [NotificationType.PostRepost]: {
    one: (name) => `${name} сделал(а) репост`,
    many: (name, others) => `${name} и ещё ${others} сделали репост`,
  },
  [NotificationType.CommentReaction]: {
    one: (name) => `${name} оценил(а) ваш комментарий`,
    many: (name, others) => `${name} и ещё ${others} оценили ваш комментарий`,
  },
  [NotificationType.CommentReply]: {
    one: (name) => `${name} ответил(а) на ваш комментарий`,
    many: (name, others) => `${name} и ещё ${others} ответили на ваш комментарий`,
  },
  [NotificationType.PostMention]: {
    one: (name) => `${name} упомянул(а) вас в посте`,
    many: (name, others) => `${name} и ещё ${others} упомянули вас в посте`,
  },
  [NotificationType.CommentMention]: {
    one: (name) => `${name} упомянул(а) вас в комментарии`,
    many: (name, others) => `${name} и ещё ${others} упомянули вас в комментарии`,
  },
  [NotificationType.WallPost]: {
    one: (name) => `${name} написал(а) на вашей стене`,
    many: (name, others) => `${name} и ещё ${others} написали на вашей стене`,
  },
  [NotificationType.VerificationApproved]: {
    one: () => 'Ваша заявка на верификацию одобрена',
    many: () => 'Ваша заявка на верификацию одобрена',
  },
  [NotificationType.VerificationRejected]: {
    one: () => 'Ваша заявка на верификацию отклонена',
    many: () => 'Ваша заявка на верификацию отклонена',
  },
});

/**
 * Собирает текст уведомления на русском.
 *
 * Повторяет формулировки сайта итд.com. Для неизвестного типа возвращает
 * «Новое уведомление» — библиотека не выдумывает текст, которого нет.
 *
 * @example
 * ```ts
 * formatNotificationText(notification);
 * // 'Аня и ещё 2 оценили ваш пост'
 * ```
 */
export function formatNotificationText(notification: Notification): string {
  const template = TEMPLATES[notification.type];
  if (!template) return FALLBACK_TEXT;

  const first = notification.actors[0];
  const name = first?.displayName || first?.username || UNKNOWN_ACTOR;

  const others = notification.count - 1;
  return others > 0 ? template.many(name, others) : template.one(name);
}
