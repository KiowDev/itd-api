# Модели данных

Формы объектов, которые возвращает API. Все поля дат — строки ISO-8601 (`IsoDate`); для разбора
есть [`toDate()`](#вспомогательные-функции). Смещения разметки измеряются в единицах UTF-16.

Особенности, о которых легко забыть:

- **`avatar` — это эмодзи, а не URL.** На итд.com аватар — символ клана (`🩵`, `🦎`).
  Отрисовывать его нужно как текст. Поле `banner` содержит URL изображения или `null`.
- **`UserRef`** = UUID или username; **`UserId`** = строго UUID.

```ts
type IsoDate = string;
type UserId = string;                    // строго UUID по смыслу API
type UserRef = string;                   // UUID или username
```

## Пользователи

### Author

Автор поста или комментария (`post.author`, `comment.author`).

```ts
interface Author {
  id: UserId;
  username: string;
  displayName: string;
  avatar: string;                        // эмодзи, не URL
  verified: boolean;
  pin?: Pin | null;                      // активный значок
  hasNuksta?: boolean;                   // премиум-подписка
}
```

### Actor

Участник события в уведомлении.

```ts
interface Actor {
  id: UserId;
  username: string;
  displayName: string;
  avatar: string;
  isFollowing?: boolean;                 // подписаны ли вы на него
  isFollowedBy?: boolean;                // подписан ли он на вас
}
```

### UserSummary

Пользователь в списках. Набор необязательных полей зависит от эндпоинта.

```ts
interface UserSummary {
  id: UserId;
  username: string;
  displayName: string;
  avatar: string;
  verified: boolean;
  isFollowing?: boolean;                 // в списках подписчиков/подписок
  hasNuksta?: boolean;                   // в поиске/рекомендациях
  followersCount?: number;               // в поиске/рекомендациях
}
```

### MyProfile

Свой профиль — ответ `itd.users.me()`.

```ts
interface MyProfile {
  id: UserId; username: string; displayName: string;
  avatar: string; banner: string | null; bio: string;
  verified: boolean; pin?: Pin | null;
  wallAccess: WallAccess;                // кто может писать на стену
  likesVisibility: LikesVisibility;      // кто видит реакции
  followersCount: number; followingCount: number; postsCount: number;
  createdAt: IsoDate;
  isPrivate: boolean;
  isPhoneVerified: boolean;
  subscription: SubscriptionState;       // { isActive, expiresAt, autoRenewal }
}
```

```ts
interface SubscriptionState {
  isActive: boolean;
  expiresAt: IsoDate | null;
  autoRenewal: boolean;
}
```

### AuthState

Состояние авторизации — ответ `itd.auth.check()`.

```ts
interface AuthState {
  authenticated: boolean;
  banned: boolean;
  user: MyProfile | null;
}
```

Без действующей сессии `authenticated` равен `false`, а `user` — `null`.

### PublicProfile

Чужой профиль — ответ `itd.users.get()`.

```ts
interface PublicProfile {
  id: UserId; username: string; displayName: string;
  avatar: string; banner: string | null; bio: string;
  verified: boolean; pin?: Pin | null;
  wallAccess: WallAccess; likesVisibility: LikesVisibility;
  followersCount: number; followingCount: number; postsCount: number;
  createdAt: IsoDate;
  hasNuksta?: boolean;
  pinnedPostId: string | null;
  isFollowing: boolean;                  // подписаны ли вы
  isFollowedBy: boolean;                 // подписан ли он на вас
  canMessage: boolean;                   // можете ли вы написать ему личное сообщение
  online: boolean;
  lastSeen: IsoDate | null;              // null, если скрыто приватностью
}

type Profile = MyProfile | PublicProfile;
isMyProfile(profile): profile is MyProfile   // различает их
```

### Pin

Значок-«пин» в профиле.

```ts
interface Pin {
  slug: string;                          // постоянный идентификатор
  name: string;
  description: string;
  url: string;                           // адрес изображения
  grantedAt?: IsoDate;                   // только в списке своих пинов
}
```

### PinsResult

```ts
interface PinsResult {
  pins: Pin[];
  activePin: string | null;              // идентификатор, а не объект
}
```

### PrivacySettings

```ts
interface PrivacySettings {
  isPrivate: boolean;                    // подписка требует одобрения
  wallAccess: WallAccess;
  likesVisibility: LikesVisibility;
  showLastSeen: boolean;
}
```

### FollowResult

```ts
interface FollowResult {
  following: boolean;                    // false, если у закрытого профиля отправлена заявка
  followersCount?: number;
  status?: 'following' | 'requested' | (string & {});
}
```

### Clan

```ts
interface Clan {
  avatar: string;                        // эмодзи клана
  memberCount: number;
}
```

## Посты и комментарии

### Post

```ts
interface Post {
  id: string;
  content: string;
  spans: Span[];                         // разметка текста
  author: Author;
  attachments: Attachment[];
  likesCount: number; commentsCount: number; repostsCount: number; viewsCount: number;
  wallRecipientId: UserId | null;        // чья стена, если пост не у себя
  wallRecipient?: Author | null;         // владелец стены
  isLiked: boolean; isReposted: boolean; isViewed: boolean; isOwner: boolean;
  originalPost?: Post | null;            // если это репост
  poll?: Poll | null;
  dominantEmoji?: string | null;         // преобладающая реакция
  editedAt: IsoDate | null;
  createdAt: IsoDate;
  vs?: string;                           // служебная метка показа для itd.telemetry
  comments?: Comment[];                  // только в ответе itd.posts.get()
}
```

### Comment

```ts
interface Comment {
  id: string;
  content: string;                       // у голосового пустой
  spans?: Span[];
  author: Author;
  likesCount: number; repliesCount: number;
  isLiked: boolean;
  createdAt: IsoDate;
  attachments?: Attachment[];            // у голосового — одно audio/ogg
  replies?: Comment[];                   // превью; полный список — comments.replies()
  replyTo?: CommentReplyTo;              // { id, username, displayName } — только у ответов
}
```

```ts
interface CommentReplyTo {
  id: string;
  username: string;
  displayName: string;
}
```

### Attachment

```ts
interface Attachment {
  id: string;
  type: AttachmentType;                  // 'image' | 'video' | 'audio'
  url: string;                           // адрес на CDN
  width?: number; height?: number;
  mimeType: string;
  filename?: string; size?: number;      // приходят не всегда
  duration?: number | null;             // аудио/видео, секунды
  order?: number;                        // порядок во вложениях
}
```

### Poll

```ts
interface Poll {
  id: string; postId: string;
  question: string;
  multipleChoice: boolean;
  options: PollOption[];                 // { id, text, votesCount, position }
  totalVotes: number;
  hasVoted: boolean;
  votedOptionIds: string[];
  createdAt: IsoDate;
}
```

```ts
interface PollOption {
  id: string;
  text: string;
  votesCount: number;
  position: number;                      // начиная с нуля
}
```

### PostStats

```ts
interface PostStats {
  id: string;
  likesCount: number; commentsCount: number; repostsCount: number; viewsCount: number;
  dominantEmoji: string | null;
}
```

### LikeResult

```ts
interface LikeResult { liked: boolean; likesCount: number; }
```

### PinPostResult

```ts
interface PinPostResult { success: boolean; pinnedPostId: string | null; }
```

### Span

Фрагмент разметки. `offset`/`length` — в единицах UTF-16.

```ts
interface Span {
  type: SpanType;
  offset: number;
  length: number;
  tag?: string;                          // имя хэштега без решётки
  url?: string;                          // только у link
  username?: string;                     // у mention
  id?: string;                           // id пользователя у некоторых mention
}
```

## Уведомления

### Notification

Единая форма для REST-списка и SSE-потока.

```ts
interface Notification {
  id: string;
  type: NotificationType;                // канонический тип
  rawType: string;                       // имя типа как прислал сервер
  entityId: string | null;               // объект события
  parentEntityId: string | null;         // родитель (пост комментария)
  isRead: boolean;
  actors: Actor[];                       // для схлопнутых — несколько
  count: number;                         // сколько участников схлопнуто; минимум 1
  preview: string | null;
  clickUrl?: string;                     // ссылка от сервера (resolveNotificationUrl обычно точнее)
  createdAt: IsoDate; updatedAt: IsoDate;
  raw: unknown;                          // исходный объект
}
```

### NotificationSettings

```ts
interface NotificationSettings {
  enabled: boolean;                      // общий выключатель
  sound: boolean;
  follows: boolean;
  wallPosts: boolean;
  likes: boolean;
  comments: boolean;
  mentions: boolean;
}
```

## Авторизация и подписка

### Session

```ts
interface Session {
  id: string;
  isCurrent: boolean;
  createdAt: IsoDate; lastUsedAt: IsoDate; expiresAt: IsoDate;
  ipAddress: string; ipCountry: string | null; ipCity: string | null;
  deviceType: 'desktop' | 'mobile' | (string & {});
  osName: string | null; osVersion: string | null;
  clientName: string | null; clientVersion: string | null;
  deviceModel: string | null;
}
```

### Subscription

```ts
interface Subscription {
  active: boolean;
  recurringEnabled: boolean;             // автопродление
  price: number;                         // рубли
}
```

### PaymentMethod

```ts
interface PaymentMethod {
  id: string;
  last4?: string;
  brand?: string;                        // 'visa' | 'mastercard' | 'mir'
  isDefault?: boolean;
  expiresAt?: IsoDate | null;
}
```

### VerificationStatus

```ts
interface VerificationStatus {
  status: 'none' | 'pending' | 'approved' | 'rejected' | (string & {});
}
```

## Поиск и платформа

### Hashtag

```ts
interface Hashtag {
  id: string;
  name: string;                          // без решётки
  postsCount: number;
}
```

### Report

```ts
interface Report { id: string; createdAt: IsoDate; }
```

### Portal

```ts
interface Portal { active: boolean; title: string; url: string; }
```

### ChangelogEntry

```ts
interface ChangelogEntry { version: string; date: string; changes: string[]; }
```

### Announcement

```ts
interface Announcement {
  id: string;
  image: { url: string; width: number; height: number };
  title: string;
  description: string;
  additional_text?: string;
  buttons: AnnouncementButton[];         // { title, style, action }
}
```

```ts
interface AnnouncementButton {
  title: string;
  style: string;
  action: { type: string; [key: string]: unknown };
}
```

### PlatformStatus

```ts
interface PlatformStatus {
  overall_status: ServiceState;          // худшее среди сервисов
  updated_at: IsoDate;
  services: ServiceStatus[];
}
```

### ServiceStatus

```ts
interface ServiceStatus {
  id: string;                            // 'auth' | 'main' | 'media' | …
  name: string;
  current_status: ServiceState;
  current_message: string;
  latency_ms: number;
  last_checked: IsoDate;                 // приведён к ISO
  uptime_90d: number;                    // проценты
  days: Record<string, StatusDay | undefined>;  // разреженный; ровный массив — statusDays()
}
```

### StatusDay

```ts
interface StatusDay {
  type: ServiceState;                    // худшее состояние за сутки
  date_key: string;                      // YYYY-MM-DD, нарезка по UTC
  uptime: number;
  lines: StatusIncidentLine[];           // { t: IncidentKind; text } — text готов к показу, время МСК
}
```

```ts
interface StatusIncidentLine {
  t: IncidentKind;
  text: string;                          // готовая строка, время МСК
}
```

## Магазин

### ShopProduct

Товар из каталога. `price` указан в рублях, `stockLeft` равен `null`, если остаток
не раскрывается.

```ts
interface ShopProduct {
  id: string;
  title: string;
  category: ShopProductCategory;
  price: number;                         // рубли
  images: string[];
  sizes: string[];
  colors: ShopProductColor[];
  description: string;
  specs: ShopProductSpec[];
  sizeChart?: ShopSizeChart | null;
  status: ShopProductStatus;
  stockLeft: number | null;
}
```

### ShopProductColor

Вариант цвета товара. `images` содержит изображения именно этого варианта.

```ts
interface ShopProductColor {
  id: string;
  label: string;
  hex: string;
  images: string[];
}
```

### ShopProductSpec

Одна характеристика товара, например материал или способ печати.

```ts
interface ShopProductSpec {
  label: string;
  value: string;
}
```

### ShopSizeChart, ShopSizeChartRow

Таблица размеров. `columns` задаёт названия измерений, а `values` каждой строки идут
в том же порядке.

```ts
interface ShopSizeChart {
  columns: string[];
  rows: ShopSizeChartRow[];
  note?: string;
}

interface ShopSizeChartRow {
  size: string;
  values: string[];
}
```

### ShopDeliveryCountry

Страна, в которую магазин может доставить заказ. `code` — двухбуквенный код страны.

```ts
interface ShopDeliveryCountry {
  code: string;
  name: string;
}
```

### ShopDeliveryCity

Город из результатов поиска службы доставки. Числовой `code` передаётся в
`delivery.points()` и `ShopDeliveryDestination`.

```ts
interface ShopDeliveryCity {
  code: number;
  name: string;
  countryCode: string;
}
```

### ShopDeliveryPoint

Пункт выдачи в выбранном городе. `code` используется как `recipient.deliveryPoint`
при создании заказа.

```ts
interface ShopDeliveryPoint {
  code: string;
  name: string;
  city: string;
  cityCode: number;
  countryCode: string;
  postalCode: string;
  address: string;
  latitude: number;
  longitude: number;
  workTime?: string;
  metro?: string;
  note?: string;
  dressingRoom: boolean;
  card: boolean;
  cash: boolean;
}
```

`dressingRoom`, `card` и `cash` показывают наличие примерочной и доступные способы
оплаты в пункте.

### ShopDeliveryDestination

Направление для расчёта доставки: код города и код его страны.

```ts
interface ShopDeliveryDestination {
  code: number;
  countryCode: string;
}
```

### ShopDeliveryCalculation

Результат расчёта доставки. Стоимость доступна в рублях и копейках, срок задан минимальным
и максимальным количеством дней.

```ts
interface ShopDeliveryCalculation {
  costKopecks: number;
  cost: number;
  periodMin: number;
  periodMax: number;
  tariffCode: number;
  tariffName: string;
  weightGrams: number;
}
```

### ShopOrderItemInput

Позиция для расчёта доставки или создания заказа. `productId` берётся из `ShopProduct.id`.

```ts
interface ShopOrderItemInput {
  productId: string;
  size: string | null;
  color: string | null;
  qty: number;
}
```

### CreateShopOrderInput

Данные для создания заказа: позиции, получатель и зафиксированные согласия.

```ts
interface CreateShopOrderInput {
  items: ShopOrderItemInput[];
  recipient: ShopRecipient;
  consents: ShopConsent[];
  consentContext: ShopConsentContext;
}
```

### ShopRecipient

Получатель и адрес доставки. Для пункта выдачи `deliveryPoint` содержит `ShopDeliveryPoint.code`.

```ts
interface ShopRecipient {
  name: string;
  phone: string;
  email: string;
  country: string;
  city: string;
  address: string;
  cityCode: number | null;
  deliveryPoint: string;
  comment: string;
}
```

### ShopConsent, ShopConsentContext

Решение покупателя по версии документа и место, где оно было получено.

```ts
interface ShopConsent {
  kind: ShopConsentKind;
  accepted: boolean;
  docSlug: string;
  docVersion: string;
}

interface ShopConsentContext {
  form: string;
  page: string;
  visitorId: string;
}
```

### ShopCreatedOrder

Результат создания заказа. Для гостевого заказа `pass` содержит временный токен доступа.

```ts
interface ShopCreatedOrder {
  number: string;
  pass?: string;
}
```

### ShopOrderSummary

Краткие сведения о заказе в `orders.list()`.

```ts
interface ShopOrderSummary {
  number: string;
  titles: string[];
  status: ShopOrderStatus;
  total: number;
  createdAt: IsoDate;
}
```

### ShopOrder

Полные сведения о заказе. `itemsTotal`, `shipping` и `total` указаны в рублях.

```ts
interface ShopOrder {
  number: string;
  status: ShopOrderStatus;
  createdAt: IsoDate;
  payment: { pending: boolean };
  items: ShopOrderItem[];
  itemsTotal: number;
  shipping: number;
  total: number;
  delivery: ShopOrderDelivery;
  track?: string | null;
  comment?: string | null;
  support?: ShopOrderSupport | null;
}
```

### ShopOrderItem

Товар в оформленном заказе. `sum` — стоимость позиции с учётом количества.

```ts
interface ShopOrderItem {
  slug: string;
  title: string;
  color?: string | null;
  size?: string | null;
  qty: number;
  sum: number;
}
```

### ShopOrderDelivery

Выбранный адрес доставки и, если применимо, пункт выдачи.

```ts
interface ShopOrderDelivery {
  city: string;
  address: string;
  point?: string | null;
}
```

### ShopOrderSupport

Контакты поддержки по заказу.

```ts
interface ShopOrderSupport {
  email: string;
  telegram?: string;
}
```

### ShopPayment

Ссылка на страницу оплаты заказа.

```ts
interface ShopPayment {
  url: string;
}
```

### ShopOrderAccessVerification

Результат проверки кода из письма. `expiresInSec` — срок действия токена в секундах.

```ts
interface ShopOrderAccessVerification {
  token: string;
  expiresInSec: number;
}
```

### ShopOrderAccessSession

Сохранённый доступ к гостевым заказам. `expiresAt` — время окончания действия
в миллисекундах Unix.

```ts
interface ShopOrderAccessSession {
  email: string;
  token: string;
  expiresAt: number;
}
```

## Вспомогательные функции

Экспортируются из корня пакета:

```ts
toDate(value: IsoDate | null | undefined): Date | null
```
Разбирает дату API в `Date`; `null`, если строки нет или она не разбирается.

```ts
utcStampToIso(value: string): string
```
Приводит UTC timestamp платформы к ISO-8601, если формат распознан; иначе возвращает
исходную строку.

```ts
statusDays(service: ServiceStatus): (StatusDay | null)[]
```
Разворачивает разреженную историю сервиса в массив на 90 суток. Индекс — сколько суток назад,
`[0]` — сегодня, пропуски равны `null`.

```ts
isMyProfile(profile: Profile): profile is MyProfile
```
Свой ли это профиль.
