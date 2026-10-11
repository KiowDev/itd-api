import type { ItdClock, ShopProduct } from 'itd-api';
import type { CommentRecord } from '../comments/comments.types.js';
import type { NotificationRecord } from '../notifications/notifications.types.js';
import type { PostRecord } from '../posts/posts.types.js';
import type { ShopAccessRecord, ShopOrderReceipt, ShopOrderRecord } from '../shop/shop.types.js';
import type { UserRecord } from '../users/users.types.js';
import type { MockStoreContents } from './store.types.js';

/** Сквозной генератор идентификаторов, пропускающий уже занятые значения. */
class IdSequence {
  #next: number;
  readonly #format: (value: number) => string;

  constructor(format: (value: number) => string, start = 1) {
    this.#format = format;
    this.#next = start;
  }

  reset(start: number): void {
    this.#next = start;
  }

  next(taken: (id: string) => boolean): string {
    let id: string;
    do id = this.#format(this.#next++);
    while (taken(id));
    return id;
  }
}

/** Хранилище данных mock-server: коллекции записей, генераторы идентификаторов и часы. @internal */
export class MockStore {
  users = new Map<string, UserRecord>();
  posts = new Map<string, PostRecord>();
  comments = new Map<string, CommentRecord>();
  notifications: NotificationRecord[] = [];
  shopProducts = new Map<string, ShopProduct>();
  shopOrders = new Map<string, ShopOrderRecord>();
  readonly shopAccess = new Map<string, ShopAccessRecord>();
  readonly shopIdempotency = new Map<string, ShopOrderReceipt>();
  readonly clock: ItdClock;
  readonly #postIds = new IdSequence((value) => `post-${value}`);
  readonly #commentIds = new IdSequence((value) => `comment-${value}`);
  readonly #notificationIds = new IdSequence((value) => `notification-${value}`);
  readonly #shopOrderNumbers = new IdSequence((value) => `SHOP-${String(value).padStart(6, '0')}`);

  constructor(clock: ItdClock) {
    this.clock = clock;
  }

  now(): string {
    return new Date(this.clock.now()).toISOString();
  }

  nextPostId(): string {
    return this.#postIds.next((id) => this.posts.has(id));
  }

  nextCommentId(): string {
    return this.#commentIds.next((id) => this.comments.has(id));
  }

  nextNotificationId(): string {
    return this.#notificationIds.next((id) => this.notifications.some((item) => item.id === id));
  }

  nextShopOrderNumber(): string {
    return this.#shopOrderNumbers.next((number) => this.shopOrders.has(number));
  }

  /** Заменяет все данные. Временные доступы магазина при этом сбрасываются. */
  load(contents: MockStoreContents): void {
    this.users = contents.users;
    this.posts = contents.posts;
    this.comments = contents.comments;
    this.notifications = contents.notifications;
    this.shopProducts = contents.shopProducts;
    this.shopOrders = contents.shopOrders;
    this.shopAccess.clear();
    this.shopIdempotency.clear();
    this.#postIds.reset(contents.postSequence);
    this.#commentIds.reset(contents.commentSequence);
    this.#notificationIds.reset(contents.notificationSequence);
    this.#shopOrderNumbers.reset(contents.shopOrderSequence);
  }
}
