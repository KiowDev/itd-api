import type { ShopProduct } from 'itd-api';
import type { CommentRecord } from '../comments/comments.types.js';
import type { NotificationRecord } from '../notifications/notifications.types.js';
import type { PostRecord } from '../posts/posts.types.js';
import type { ShopOrderRecord } from '../shop/shop.types.js';
import type { UserRecord } from '../users/users.types.js';

/** Полный набор данных хранилища, которым оно атомарно заменяется. @internal */
export interface MockStoreContents {
  users: Map<string, UserRecord>;
  posts: Map<string, PostRecord>;
  comments: Map<string, CommentRecord>;
  /** Сначала новые. */
  notifications: NotificationRecord[];
  shopProducts: Map<string, ShopProduct>;
  shopOrders: Map<string, ShopOrderRecord>;
  postSequence: number;
  commentSequence: number;
  notificationSequence: number;
  shopOrderSequence: number;
}
