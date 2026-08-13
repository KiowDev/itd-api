import type {
  ItdClientOptions,
  ItdClock,
  MyProfile,
  Notification,
  ShopOrder,
  ShopProduct,
} from 'itd-api';
import type { MockEventTransport } from '../events.js';
import type { RecordedRequest } from '../request.js';
import type { MockHandler } from '../router.js';

export interface MockUserSeed {
  id?: string;
  username?: string;
  displayName?: string;
  avatar?: string;
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

/** Уведомление из снимка сервера. */
export type MockNotificationSnapshot = Readonly<Omit<Notification, 'actors'>> & {
  readonly actors: readonly Readonly<Notification['actors'][number]>[];
  readonly userId: string;
};

export interface MockServerClientOptions {
  /** Идентификатор или имя пользователя из seed. */
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
