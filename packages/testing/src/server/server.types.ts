import type {
  ItdClientOptions,
  ItdClock,
  MyProfile,
  Notification,
  ShopOrder,
  ShopProduct,
  Span,
} from 'itd-api';
import type { MockEventTransport } from '../events/mock-event.transport.js';
import type { RecordedRequest } from '../http/request.types.js';
import type { MockHandler } from '../http/router.types.js';
import type { CommentPresenter } from './comments/comments.presenter.js';
import type { CommentService } from './comments/comments.service.js';
import type { HashtagPresenter } from './hashtags/hashtags.presenter.js';
import type { HashtagService } from './hashtags/hashtags.service.js';
import type { NotificationPresenter } from './notifications/notifications.presenter.js';
import type { NotificationService } from './notifications/notifications.service.js';
import type { PostPresenter } from './posts/posts.presenter.js';
import type { PostService } from './posts/posts.service.js';
import type { SearchPresenter } from './search/search.presenter.js';
import type { SearchService } from './search/search.service.js';
import type { ShopService } from './shop/shop.service.js';
import type { UserPresenter } from './users/users.presenter.js';
import type { UserService } from './users/users.service.js';

export interface MockUserSeed {
  id?: string;
  username?: string;
  displayName?: string;
  avatar?: string;
  /** Эмодзи клана. По умолчанию — `avatar`, если он не адрес изображения. */
  clanAvatar?: string;
  banner?: string | null;
  bio?: string;
  verified?: boolean;
  wallAccess?: MyProfile['wallAccess'];
  likesVisibility?: MyProfile['likesVisibility'];
  createdAt?: string;
  isPrivate?: boolean;
  isPhoneVerified?: boolean;
  subscription?: MyProfile['subscription'];
  following?: readonly string[];
  deactivated?: boolean;
}

export interface MockPostSeed {
  id?: string;
  authorId: string;
  content?: string;
  spans?: readonly Span[];
  /** Пост, который репостнули. Репост репоста ссылается на репост, а не на начало цепочки. */
  originalPostId?: string | null;
  wallRecipientId?: string | null;
  createdAt?: string;
  likedBy?: readonly string[];
  deleted?: boolean;
}

export interface MockCommentSeed {
  id?: string;
  postId: string;
  authorId: string;
  parentCommentId?: string | null;
  replyToUserId?: string;
  content?: string;
  createdAt?: string;
  likedBy?: readonly string[];
  deleted?: boolean;
}

export interface MockNotificationSeed {
  id?: string;
  userId: string;
  type?: Notification['type'];
  actorIds?: readonly string[];
  entityId?: string | null;
  parentEntityId?: string | null;
  preview?: string | null;
  isRead?: boolean;
  createdAt?: string;
}

export interface MockShopOrderSeed {
  value: ShopOrder;
  userId?: string;
  email: string;
  accessToken?: string;
}

export interface MockServerSeed {
  users?: readonly MockUserSeed[];
  posts?: readonly MockPostSeed[];
  comments?: readonly MockCommentSeed[];
  notifications?: readonly MockNotificationSeed[];
  shopProducts?: readonly ShopProduct[];
  shopOrders?: readonly MockShopOrderSeed[];
}

export interface CreateMockServerOptions {
  seed?: MockServerSeed;
  clock?: ItdClock;
  baseUrl?: string;
}

export interface MockServerSnapshot {
  readonly users: readonly MockUserSnapshot[];
  readonly posts: readonly MockPostSnapshot[];
  readonly comments: readonly MockCommentSnapshot[];
  readonly notifications: readonly MockNotificationSnapshot[];
  readonly shopProducts: readonly Readonly<ShopProduct>[];
  readonly shopOrders: readonly MockShopOrderSnapshot[];
}

export interface MockShopOrderSnapshot {
  readonly value: Readonly<ShopOrder>;
  readonly userId?: string;
  readonly email: string;
  readonly accessToken?: string;
}

/** Пользователь из снимка сервера. */
export type MockUserSnapshot = Readonly<Omit<MyProfile, 'subscription'>> & {
  readonly subscription: Readonly<MyProfile['subscription']>;
  readonly following: readonly string[];
  readonly deactivated: boolean;
};

/** Запись из снимка сервера. */
export interface MockPostSnapshot {
  readonly id: string;
  readonly authorId: string;
  readonly content: string;
  readonly spans: readonly Readonly<Span>[];
  readonly originalPostId: string | null;
  readonly wallRecipientId: string | null;
  readonly createdAt: string;
  readonly editedAt: string | null;
  readonly likedBy: readonly string[];
  readonly deleted: boolean;
}

/** Комментарий или ответ из снимка сервера. */
export interface MockCommentSnapshot {
  readonly id: string;
  readonly postId: string;
  readonly authorId: string;
  readonly parentCommentId: string | null;
  readonly replyToUserId: string | undefined;
  readonly content: string;
  readonly createdAt: string;
  readonly likedBy: readonly string[];
  readonly deleted: boolean;
}

/** Уведомление из снимка сервера. Участники и получатель представлены идентификаторами. */
export interface MockNotificationSnapshot {
  readonly id: string;
  readonly userId: string;
  readonly type: Notification['type'];
  readonly actorIds: readonly string[];
  readonly entityId: string | null;
  readonly parentEntityId: string | null;
  readonly preview: string | null;
  readonly isRead: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface MockServerClientOptions {
  /** Идентификатор пользователя или его текущее имя. */
  as: string;
}

export interface MockServer {
  readonly fetch: typeof fetch;
  readonly requests: readonly RecordedRequest[];
  readonly unsupportedRequests: readonly RecordedRequest[];
  clientOptions(options: MockServerClientOptions): ItdClientOptions;
  snapshot(): MockServerSnapshot;
  reset(seed?: MockServerSeed): void;
  failNext(method: string, path: string, responder: Response | Error | MockHandler): void;
  /** Устанавливает обработчик перед встроенными маршрутами и возвращает функцию снятия. */
  override(method: string, path: string, handler: MockHandler): () => void;
  notificationEvents(options: MockServerClientOptions): MockEventTransport;
  assertNoUnsupportedRequests(): void;
  clearRequests(): void;
}

/** Доменные сервисы mock-server. @internal */
export interface MockServices {
  readonly users: UserService;
  readonly posts: PostService;
  readonly comments: CommentService;
  readonly notifications: NotificationService;
  readonly hashtags: HashtagService;
  readonly search: SearchService;
  readonly shop: ShopService;
}

/** Сборщики моделей ответов API. @internal */
export interface MockPresenters {
  readonly users: UserPresenter;
  readonly posts: PostPresenter;
  readonly comments: CommentPresenter;
  readonly notifications: NotificationPresenter;
  readonly hashtags: HashtagPresenter;
  readonly search: SearchPresenter;
}
