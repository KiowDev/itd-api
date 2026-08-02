import type { LikesVisibility, Loose, WallAccess } from '../types/enums.js';
import type { IsoDate, UserId } from './common.js';

/** Значок-«пин» в профиле — награда или отметка платформы. */
export interface Pin {
  /** Постоянный идентификатор, например `epepuy_202605_59`. */
  slug: string;
  /** Отображаемое название. */
  name: string;
  /** Описание, за что выдан. */
  description: string;
  /** Адрес изображения. */
  url: string;
  /** Когда выдан. Приходит только в списке своих пинов. */
  grantedAt?: IsoDate;
}

/**
 * Автор поста или комментария.
 *
 * Встречается внутри `post.author` и `comment.author`.
 */
export interface Author {
  id: UserId;
  username: string;
  displayName: string;
  /**
   * **Эмодзи, а не картинка.**
   *
   * На итд.com аватар — это символ клана (`🩵`, `🦎`), а не адрес изображения.
   * Отрисовывать его нужно как текст.
   */
  avatar: string;
  /** Пройдена ли верификация. */
  verified: boolean;
  /** Активный значок профиля. Может отсутствовать. */
  pin?: Pin | null;
  /** Есть ли премиум-подписка (значок NUKSTA). */
  hasNuksta?: boolean;
}

/**
 * Участник события в уведомлении.
 *
 * Отличается от {@link Author} набором полей: вместо значков приходит связь с вами.
 */
export interface Actor {
  id: UserId;
  username: string;
  displayName: string;
  /** Эмодзи-аватар, см. {@link Author.avatar}. */
  avatar: string;
  /** Подписаны ли вы на этого пользователя. */
  isFollowing?: boolean;
  /** Подписан ли он на вас. */
  isFollowedBy?: boolean;
}

/**
 * Пользователь в списках.
 *
 * Набор полей зависит от эндпоинта: подписчики и подписки приносят `isFollowing`,
 * поиск и рекомендации — `followersCount` и `hasNuksta`. Необязательные поля отражают
 * это различие.
 */
export interface UserSummary {
  id: UserId;
  username: string;
  displayName: string;
  /** Эмодзи-аватар, см. {@link Author.avatar}. */
  avatar: string;
  verified: boolean;
  /** Подписаны ли вы. Приходит в списках подписчиков и подписок. */
  isFollowing?: boolean;
  /** Есть ли премиум. Приходит в поиске и рекомендациях. */
  hasNuksta?: boolean;
  /** Число подписчиков. Приходит в поиске и рекомендациях. */
  followersCount?: number;
}

/** Поля профиля, общие для своего и чужого. */
interface ProfileBase {
  id: UserId;
  username: string;
  displayName: string;
  /** Эмодзи-аватар, см. {@link Author.avatar}. */
  avatar: string;
  /** URL изображения баннера либо `null`. */
  banner: string | null;
  /** Описание профиля. */
  bio: string;
  verified: boolean;
  pin?: Pin | null;
  /** Кто может писать на стену. */
  wallAccess: WallAccess;
  /** Кто видит реакции. */
  likesVisibility: LikesVisibility;
  followersCount: number;
  followingCount: number;
  postsCount: number;
  createdAt: IsoDate;
}

/** Состояние подписки на премиум. */
export interface SubscriptionState {
  isActive: boolean;
  expiresAt: IsoDate | null;
  autoRenewal: boolean;
}

/**
 * Свой профиль — ответ `GET /api/users/me`.
 *
 * Отличается от чужого наличием {@link subscription} и {@link isPhoneVerified}
 * и отсутствием полей связи (`isFollowing`, `online`).
 */
export interface MyProfile extends ProfileBase {
  /** Закрыт ли профиль. */
  isPrivate: boolean;
  /** Подтверждён ли телефон. Без него часть действий недоступна. */
  isPhoneVerified: boolean;
  /** Своя премиум-подписка. */
  subscription: SubscriptionState;
}

/**
 * Состояние авторизации — ответ `GET /api/profile`.
 *
 * Endpoint доступен без сессии: в этом случае `authenticated` равен `false`,
 * а `user` — `null`.
 */
export interface AuthState {
  /** Есть ли действующая сессия. */
  authenticated: boolean;
  /** Заблокирован ли текущий аккаунт. */
  banned: boolean;
  /** Текущий пользователь либо `null` без действующей сессии. */
  user: MyProfile | null;
}

/**
 * Чужой профиль — ответ `GET /api/users/{id|username}`.
 *
 * Вместо своей подписки содержит связь с вами и присутствие.
 */
export interface PublicProfile extends ProfileBase {
  hasNuksta?: boolean;
  /** Закреплённый пост, если он есть. */
  pinnedPostId: string | null;
  /** Подписаны ли вы на него. */
  isFollowing: boolean;
  /** Подписан ли он на вас. */
  isFollowedBy: boolean;
  /** Сейчас ли пользователь в сети. */
  online: boolean;
  /** Когда был в сети. `null`, если скрыто настройками приватности. */
  lastSeen: IsoDate | null;
}

/** Профиль: свой либо чужой. Различаются функцией `isMyProfile()`. */
export type Profile = MyProfile | PublicProfile;

/** Настройки приватности профиля. */
export interface PrivacySettings {
  /** Закрыт ли профиль: подписка требует одобрения. */
  isPrivate: boolean;
  wallAccess: WallAccess;
  likesVisibility: LikesVisibility;
  /** Показывать ли время последнего посещения. */
  showLastSeen: boolean;
}

/**
 * Результат подписки на пользователя.
 *
 * @example
 * ```ts
 * const result = await itd.users.follow('nowkie');
 * // { following: true, followersCount: 11 }
 * ```
 */
export interface FollowResult {
  /** Подписка оформлена. У закрытого профиля отправляется заявка, и здесь будет `false`. */
  following: boolean;
  /** Сколько подписчиков стало у пользователя после действия. */
  followersCount?: number;
  /** Статус заявки, если профиль закрыт. */
  status?: Loose<'following' | 'requested'>;
}

/** Закреплённые значки профиля и выбранный из них. */
export interface PinsResult {
  pins: Pin[];
  /** Идентификатор активного значка — строка, а не объект. */
  activePin: string | null;
}
