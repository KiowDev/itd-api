import type {
  AttachmentType,
  IncidentKind,
  LikesVisibility,
  Loose,
  NotificationType,
  ServiceState,
  SpanType,
  WallAccess,
} from './enums.js';

/**
 * Дата и время в формате ISO-8601, например `2026-07-21T14:30:00.000Z`.
 *
 * Библиотека не превращает такие поля в `Date`: строку проще сравнивать, логировать
 * и передавать дальше без потерь. Для разбора есть {@link toDate}.
 */
export type IsoDate = string;

/**
 * Идентификатор пользователя — **строго UUID**.
 *
 * Отличается от {@link UserRef} тем, что имя пользователя здесь не подойдёт. Так помечены
 * места, где API принимает только UUID: например `wallRecipientId` при постинге на чужую стену.
 */
export type UserId = string;

/**
 * Ссылка на пользователя: **UUID либо имя пользователя**.
 *
 * Пути вида `/api/users/{id}` принимают оба варианта, поэтому `itd.users.get('durov')`
 * работает так же, как `itd.users.get('9f1c…')`.
 */
export type UserRef = string;

/**
 * Разметка в тексте поста.
 *
 * Приходит от сервера и отправляется обратно как есть — библиотека разметку не генерирует
 * и не пересчитывает.
 *
 * Единицы `offset` и `length` в документации API не уточнены (UTF-16 или кодовые точки),
 * поэтому при работе с эмодзи проверяйте результат.
 */
export interface Span {
  /** Тип фрагмента — см. {@link SpanType}. */
  type: SpanType;
  /** Смещение от начала текста. */
  offset: number;
  /** Длина фрагмента. */
  length: number;
  /** Имя хэштега без решётки либо имя пользователя. */
  tag?: string;
  /** Адрес ссылки. Только у `link`: у него вместо `tag` отдельное поле. */
  url?: string;
}

/**
 * Значок-«пин» в профиле — награда или отметка платформы.
 */
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
  /** Адрес изображения-шапки либо `null`. В отличие от аватара это настоящий URL. */
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

/** Профиль: свой либо чужой. Различаются функцией {@link isMyProfile}. */
export type Profile = MyProfile | PublicProfile;

/**
 * Свой ли это профиль.
 *
 * @example
 * ```ts
 * if (isMyProfile(profile)) console.log(profile.subscription.isActive);
 * ```
 */
export function isMyProfile(profile: Profile): profile is MyProfile {
  return 'subscription' in profile;
}

/** Вложение поста или комментария. */
export interface Attachment {
  id: string;
  type: AttachmentType;
  /** Адрес файла на CDN. */
  url: string;
  /** Ширина изображения или видео в пикселях. */
  width?: number;
  /** Высота изображения или видео в пикселях. */
  height?: number;
  mimeType: string;
  /** Исходное имя файла. Приходит не всегда. */
  filename?: string;
  /** Размер в байтах. Приходит не всегда. */
  size?: number;
  /** Длительность аудио или видео в секундах. */
  duration?: number | null;
  /** Порядковый номер во вложениях поста. */
  order?: number;
}

/** Вариант ответа в опросе. */
export interface PollOption {
  id: string;
  text: string;
  /** Сколько голосов отдано за этот вариант. */
  votesCount: number;
  /** Порядковый номер варианта, начиная с нуля. */
  position: number;
}

/** Опрос внутри поста. */
export interface Poll {
  id: string;
  /** Пост, которому принадлежит опрос. */
  postId: string;
  question: string;
  /** Можно ли выбрать несколько вариантов. */
  multipleChoice: boolean;
  options: PollOption[];
  totalVotes: number;
  /** Голосовали ли вы. */
  hasVoted: boolean;
  /** За что проголосовали вы. Пустой массив, если голоса не было. */
  votedOptionIds: string[];
  createdAt: IsoDate;
}

/** Пост ленты, стены или профиля. */
export interface Post {
  id: string;
  content: string;
  /** Разметка текста. Передаётся без изменений, см. {@link Span}. */
  spans: Span[];
  author: Author;
  attachments: Attachment[];
  likesCount: number;
  commentsCount: number;
  repostsCount: number;
  viewsCount: number;
  /** Чья это стена, если пост опубликован не у себя. */
  wallRecipientId: UserId | null;
  /** Владелец стены. Приходит не во всех ответах. */
  wallRecipient?: Author | null;
  /** Поставили ли вы реакцию. */
  isLiked: boolean;
  /** Делали ли вы репост. */
  isReposted: boolean;
  /** Засчитан ли просмотр. */
  isViewed: boolean;
  /** Ваш ли это пост. */
  isOwner: boolean;
  /** Исходный пост, если это репост. */
  originalPost?: Post | null;
  poll?: Poll | null;
  /** Преобладающая реакция — эмодзи либо `null`. */
  dominantEmoji?: string | null;
  /** Когда пост отредактировали. `null`, если не редактировали. */
  editedAt: IsoDate | null;
  createdAt: IsoDate;
  /**
   * Служебная метка показа для телеметрии.
   *
   * Нужна только эндпоинтам `itd.telemetry.*`. В остальных случаях игнорируйте.
   */
  vs?: string;
  /**
   * Топовые комментарии. Приходят только в ответе `GET /api/posts/{id}`.
   *
   * В списках постов поле отсутствует.
   */
  comments?: Comment[];
}

/** На чей комментарий дан ответ. */
export interface CommentReplyTo {
  id: string;
  username: string;
  displayName: string;
}

/** Комментарий к посту или ответ на комментарий. */
export interface Comment {
  id: string;
  /** Текст. У голосового комментария пустой. */
  content: string;
  author: Author;
  likesCount: number;
  repliesCount: number;
  isLiked: boolean;
  createdAt: IsoDate;
  /** Вложения. У голосового — одно аудио с `mimeType: 'audio/ogg'`. */
  attachments?: Attachment[];
  /** Вложенные ответы. В списках приходит превью, полный список — через `itd.comments.replies()`. */
  replies?: Comment[];
  /** Заполнено только у ответов. */
  replyTo?: CommentReplyTo;
}

/**
 * Уведомление в единой форме.
 *
 * REST-список и SSE-поток отдают уведомления по-разному — разные имена типов, разные имена
 * полей, один участник против массива. Библиотека приводит оба вида к этой структуре,
 * поэтому объекты из `itd.notifications.list()` и из потока можно складывать в один список.
 *
 * Исходные данные не теряются: сервeрное имя типа остаётся в {@link rawType},
 * а весь необработанный объект — в {@link raw}.
 */
export interface Notification {
  id: string;
  /** Канонический тип. Старые имена (`like`, `comment`) приведены к новым. */
  type: NotificationType;
  /** Имя типа в том виде, в каком его прислал сервер. */
  rawType: string;
  /** Объект события: пост, комментарий, пользователь. */
  entityId: string | null;
  /** Пост, которому принадлежит комментарий, если событие о комментарии. */
  parentEntityId: string | null;
  /** Прочитано ли уведомление. */
  isRead: boolean;
  /** Кто совершил действие. Для схлопнутых уведомлений — несколько человек. */
  actors: Actor[];
  /** Сколько участников схлопнуто в одно уведомление. Минимум 1. */
  count: number;
  /** Текст или заголовок объекта события. */
  preview: string | null;
  /** Ссылка перехода, предложенная сервером. Обычно точнее её `resolveNotificationUrl()`. */
  clickUrl?: string;
  createdAt: IsoDate;
  /** Когда уведомление изменилось — например было прочитано. */
  updatedAt: IsoDate;
  /** Исходный объект как он пришёл от сервера. */
  raw: unknown;
}

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
 * Настройки уведомлений.
 *
 * Сервер отдаёт плоский объект, но исторически знает два набора имён для одних и тех же
 * настроек (`likes` и `reactions`, `comments` и `replies`). При сохранении библиотека
 * отправляет оба, при чтении принимает любой.
 */
export interface NotificationSettings {
  /** Общий выключатель доставки. */
  enabled: boolean;
  /** Звук уведомления. */
  sound: boolean;
  /** Новые подписчики. */
  follows: boolean;
  /** Записи на вашей стене. */
  wallPosts: boolean;
  /** Реакции на ваши записи. */
  likes: boolean;
  /** Комментарии и ответы. */
  comments: boolean;
  /** Упоминания. */
  mentions: boolean;
}

/** Активная сессия входа. */
export interface Session {
  id: string;
  /** Та ли это сессия, из которой выполнен запрос. */
  isCurrent: boolean;
  createdAt: IsoDate;
  lastUsedAt: IsoDate;
  expiresAt: IsoDate;
  ipAddress: string;
  /** Код страны по IP, например `RU`. */
  ipCountry: string | null;
  ipCity: string | null;
  deviceType: Loose<'desktop' | 'mobile'>;
  osName: string | null;
  osVersion: string | null;
  /** Название браузера или приложения. */
  clientName: string | null;
  clientVersion: string | null;
  deviceModel: string | null;
}

/** Состояние платной подписки и её цена. */
export interface Subscription {
  /** Активна ли подписка сейчас. */
  active: boolean;
  /** Включено ли автопродление. */
  recurringEnabled: boolean;
  /** Цена в рублях. */
  price: number;
}

/** Сохранённый способ оплаты. */
export interface PaymentMethod {
  id: string;
  /** Последние четыре цифры карты. */
  last4?: string;
  /** Платёжная система: `visa`, `mastercard`, `mir`. */
  brand?: string;
  /** Основной ли это способ оплаты. */
  isDefault?: boolean;
  expiresAt?: IsoDate | null;
}

/** Хэштег. */
export interface Hashtag {
  id: string;
  /** Название без решётки. */
  name: string;
  /** Сколько постов с этим хэштегом. */
  postsCount: number;
}

/** Клан в рейтинге. */
export interface Clan {
  /** Эмодзи клана — оно же аватар его участников. */
  avatar: string;
  memberCount: number;
}

/**
 * Результат подписки на пользователя.
 *
 * @example
 * ```ts
 * const result = await itd.users.follow('durov');
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

/** Запись журнала изменений платформы. */
export interface ChangelogEntry {
  version: string;
  date: string;
  changes: string[];
}

/** Кнопка в анонсе платформы. */
export interface AnnouncementButton {
  title: string;
  /** Оформление: `primary`, `secondary` и другие. */
  style: string;
  action: { type: string; [key: string]: unknown };
}

/** Анонс на главной странице платформы. */
export interface Announcement {
  id: string;
  image: { url: string; width: number; height: number };
  title: string;
  description: string;
  /** Дополнительный текст мелким шрифтом. */
  additional_text?: string;
  buttons: AnnouncementButton[];
}

/** Баннер текущего события — виджет «портал». */
export interface Portal {
  active: boolean;
  title: string;
  url: string;
}

/** Глубина истории статуса в сутках. Столько элементов отдаёт {@link statusDays}. */
const STATUS_WINDOW_DAYS = 90;

/** Происшествие в истории сервиса. */
export interface StatusIncidentLine {
  /** Вид происшествия. */
  t: IncidentKind;
  /**
   * Готовая строка для показа: `недоступен 6 мин (12:00–12:06)`. Время московское.
   * Длительность и границы интервала отдельными полями не приходят.
   */
  text: string;
}

/** Одни сутки в истории сервиса. */
export interface StatusDay {
  /** Худшее состояние за сутки. */
  type: ServiceState;
  /** Дата суток, `YYYY-MM-DD`. Сутки нарезаны по UTC. */
  date_key: string;
  /** Доступность за сутки в процентах. */
  uptime: number;
  /** Происшествия за сутки. */
  lines: StatusIncidentLine[];
}

/** Сервис платформы и его история доступности. */
export interface ServiceStatus {
  /** Идентификатор: `auth`, `main`, `media` и прочие. */
  id: string;
  /** Отображаемое название. */
  name: string;
  current_status: ServiceState;
  /** Пояснение к текущему состоянию, например `No downtime`. */
  current_message: string;
  /** Задержка последней проверки в миллисекундах. */
  latency_ms: number;
  /**
   * Момент последней проверки. Сервер отдаёт `YYYY-MM-DD HH:mm:ss` в UTC, библиотека
   * приводит значение к ISO.
   */
  last_checked: IsoDate;
  /** Доступность за 90 суток в процентах. */
  uptime_90d: number;
  /**
   * История по суткам. Ключ — сколько суток назад, `'0'` — сегодня.
   *
   * Объект разреженный: сутки без данных сервер пропускает. Ровный массив даёт
   * {@link statusDays}.
   */
  days: Record<string, StatusDay | undefined>;
}

/** Состояние платформы — ответ `itd.platform.status()`. */
export interface PlatformStatus {
  /** Худшее состояние среди сервисов. */
  overall_status: ServiceState;
  /** Когда данные последний раз пересчитаны. */
  updated_at: IsoDate;
  services: ServiceStatus[];
}

/** Статус заявки на верификацию. `none` означает, что заявка не подавалась. */
export interface VerificationStatus {
  status: Loose<'none' | 'pending' | 'approved' | 'rejected'>;
}

/** Созданная жалоба. */
export interface Report {
  id: string;
  createdAt: IsoDate;
}

/** Счётчики поста из `itd.posts.stats()`. */
export interface PostStats {
  id: string;
  likesCount: number;
  commentsCount: number;
  repostsCount: number;
  viewsCount: number;
  /** Преобладающая реакция — эмодзи либо `null`. */
  dominantEmoji: string | null;
}

/** Результат реакции на пост. */
export interface LikeResult {
  liked: boolean;
  likesCount: number;
}

/** Результат закрепления поста в профиле. */
export interface PinPostResult {
  success: boolean;
  pinnedPostId: string | null;
}

/** Закреплённые значки профиля и выбранный из них. */
export interface PinsResult {
  pins: Pin[];
  /** Идентификатор активного значка — строка, а не объект. */
  activePin: string | null;
}

/**
 * Разбирает дату API в объект `Date`.
 *
 * @returns `null`, если строки нет или она не разбирается
 *
 * @example
 * ```ts
 * const created = toDate(post.createdAt);
 * ```
 */
export function toDate(value: IsoDate | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

/**
 * Разворачивает историю сервиса в массив на 90 суток.
 * Сутки без данных становятся `null`.
 *
 * @returns массив, где индекс — сколько суток назад: `[0]` — сегодня
 *
 * @example
 * ```ts
 * const status = await itd.platform.status();
 * const days = statusDays(status.services[0]);
 *
 * days[0]?.uptime;                              // доступность за сегодня
 * days.filter((day) => day === null).length;    // за сколько суток данных нет
 * ```
 */
export function statusDays(service: ServiceStatus): (StatusDay | null)[] {
  return Array.from(
    { length: STATUS_WINDOW_DAYS },
    (_, index) => service.days[String(index)] ?? null,
  );
}
