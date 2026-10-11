import type {
  LastSeenUnit,
  LikesVisibility,
  Loose,
  MessageAccess,
  UsernameUnavailableReason,
  WallAccess,
} from '../types/enums.js';
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
 * Общая часть всех моделей пользователя: автора, участника уведомления, пользователя
 * из списка, профиля.
 */
export interface UserBase {
  id: UserId;
  username: string;
  displayName: string;
}

/**
 * Автор поста или комментария.
 *
 * Встречается внутри `post.author` и `comment.author`.
 */
export interface Author extends UserBase {
  /**
   * Аватар: обычно эмодзи — символ клана (`🩵`, `🦎`), который отрисовывают как текст.
   *
   * Может быть и адресом изображения. Клан пользователя в этом случае хранится отдельно,
   * в `clanAvatar` профиля.
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
export interface Actor extends UserBase {
  /** Аватар: эмодзи или адрес изображения, см. {@link Author.avatar}. */
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
export interface UserSummary extends UserBase {
  /** Аватар: эмодзи или адрес изображения, см. {@link Author.avatar}. */
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
interface ProfileBase extends UserBase {
  /** Аватар: эмодзи или адрес изображения, см. {@link Author.avatar}. */
  avatar: string;
  /**
   * Эмодзи клана. Совпадает с `avatar`, пока аватар — эмодзи; при аватаре-картинке остаётся
   * символом клана.
   */
  clanAvatar?: string;
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

/** Компактные данные текущего пользователя из {@link AuthState}. */
export interface AuthUser extends UserBase {
  /** Аватар: эмодзи или адрес изображения, см. {@link Author.avatar}. */
  avatar: string;
  /** Эмодзи клана. Совпадает с `avatar`, пока аватар — эмодзи. */
  clanAvatar?: string;
  bio: string;
  verified: boolean;
  isPhoneVerified: boolean;
  /** Роли текущего пользователя, например `user`. */
  roles: string[];
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
  /** Компактные данные текущего пользователя либо `null` без действующей сессии. */
  user: AuthUser | null;
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
  /** Может ли текущий пользователь написать этому профилю личное сообщение. */
  canMessage: boolean;
  /** Сейчас ли пользователь в сети. */
  online: boolean;
  /** Сколько времени назад был в сети. `null` — пользователь в сети либо скрыл это время. */
  lastSeen: LastSeen | null;
}

/**
 * Время с последнего визита: число и единица, например `{ value: 5, unit: 'minutes' }`.
 *
 * @example
 * ```ts
 * const { lastSeen } = await itd.users.get('kiow');
 * if (lastSeen?.unit === LastSeenUnit.Minutes) console.log(`был ${lastSeen.value} мин назад`);
 * ```
 */
export interface LastSeen {
  value: number;
  unit: LastSeenUnit;
}

/** Профиль: свой либо чужой. Различаются функцией `isMyProfile()`. */
export type Profile = MyProfile | PublicProfile;

/** Результат проверки имени пользователя. */
export interface UsernameAvailability {
  /** Свободно ли имя. Своё текущее имя сервер считает занятым. */
  available: boolean;
  /** Причина, если имя не подходит по формату. У занятого имени причины нет. */
  reason?: UsernameUnavailableReason;
}

/** Настройки приватности профиля. */
export interface PrivacySettings {
  /** Закрыт ли профиль: подписка требует одобрения. */
  isPrivate: boolean;
  wallAccess: WallAccess;
  likesVisibility: LikesVisibility;
  /** Кто может писать личные сообщения. */
  messageAccess: MessageAccess;
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
