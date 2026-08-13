import type {
  Comment,
  ItdClock,
  MyProfile,
  Notification,
  Post,
  PublicProfile,
  ShopProduct,
} from 'itd-api';
import { MockEventTransport } from '../events.js';
import {
  commentFixture,
  notificationFixture,
  postFixture,
  publicProfileFixture,
} from '../fixtures.js';
import type { MockRequest } from '../request.js';
import type { MockServerSeed, MockServerSnapshot } from './contracts.js';
import type {
  CommentState,
  NotificationState,
  PostState,
  ShopOrderState,
  UserState,
} from './entities.js';
import { buildMockServerSeed } from './seed.js';

function decodeToken(token: string): Record<string, unknown> | undefined {
  try {
    const segment = token.split('.')[1];
    if (!segment) return undefined;
    const normalized = segment
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(segment.length / 4) * 4, '=');
    return JSON.parse(atob(normalized)) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/** Изменяемое доменное состояние in-memory mock server. @internal */
export class MockServerState {
  users = new Map<string, UserState>();
  posts = new Map<string, PostState>();
  comments = new Map<string, CommentState>();
  notifications: NotificationState[] = [];
  shopProducts = new Map<string, ShopProduct>();
  shopOrders = new Map<string, ShopOrderState>();
  readonly shopAccess = new Map<string, { email: string; expiresAt: number }>();
  readonly shopIdempotency = new Map<string, { number: string; pass?: string }>();
  readonly eventTransports = new Map<string, Set<MockEventTransport>>();
  readonly clock: ItdClock;
  #postSequence = 1;
  #commentSequence = 1;
  #notificationSequence = 1;
  #shopOrderSequence = 1;

  constructor(clock: ItdClock) {
    this.clock = clock;
  }

  now(): string {
    return new Date(this.clock.now()).toISOString();
  }

  findUser(reference: string): UserState | undefined {
    return (
      this.users.get(reference) ??
      [...this.users.values()].find((item) => item.profile.username === reference)
    );
  }

  actor(user: UserState): Notification['actors'][number] {
    return {
      id: user.profile.id,
      username: user.profile.username,
      displayName: user.profile.displayName,
      avatar: user.profile.avatar,
    };
  }

  activePostsBy(userId: string): number {
    return [...this.posts.values()].filter((post) => !post.deleted && post.authorId === userId)
      .length;
  }

  followersOf(userId: string): number {
    return [...this.users.values()].filter((user) => user.following.has(userId)).length;
  }

  myProfile(user: UserState): MyProfile {
    return {
      ...user.profile,
      followersCount: this.followersOf(user.profile.id),
      followingCount: user.following.size,
      postsCount: this.activePostsBy(user.profile.id),
      subscription: { ...user.profile.subscription },
    };
  }

  publicProfile(viewer: UserState, user: UserState): PublicProfile {
    return publicProfileFixture({
      ...user.profile,
      followersCount: this.followersOf(user.profile.id),
      followingCount: user.following.size,
      postsCount: this.activePostsBy(user.profile.id),
      isFollowing: viewer.following.has(user.profile.id),
      isFollowedBy: user.following.has(viewer.profile.id),
    });
  }

  postModel(value: PostState, viewer: UserState): Post {
    const authorState = this.users.get(value.authorId);
    if (!authorState) throw new Error(`У поста ${value.id} нет автора ${value.authorId}`);
    return postFixture({
      id: value.id,
      content: value.content,
      author: this.actor(authorState),
      wallRecipientId: value.wallRecipientId,
      likesCount: value.likedBy.size,
      commentsCount: [...this.comments.values()].filter(
        (comment) => comment.postId === value.id && !comment.deleted,
      ).length,
      isLiked: value.likedBy.has(viewer.profile.id),
      isOwner: value.authorId === viewer.profile.id,
      editedAt: value.editedAt,
      createdAt: value.createdAt,
    });
  }

  commentModel(value: CommentState, viewer: UserState): Comment {
    const authorState = this.users.get(value.authorId);
    if (!authorState) throw new Error(`У комментария ${value.id} нет автора ${value.authorId}`);
    const replyTo = value.replyToUserId ? this.users.get(value.replyToUserId) : undefined;
    return commentFixture({
      id: value.id,
      content: value.content,
      author: this.actor(authorState),
      likesCount: value.likedBy.size,
      repliesCount: [...this.comments.values()].filter(
        (item) => item.parentCommentId === value.id && !item.deleted,
      ).length,
      isLiked: value.likedBy.has(viewer.profile.id),
      createdAt: value.createdAt,
      ...(replyTo
        ? {
            replyTo: {
              id: replyTo.profile.id,
              username: replyTo.profile.username,
              displayName: replyTo.profile.displayName,
            },
          }
        : {}),
    });
  }

  unreadCount(userId: string): number {
    return this.notifications.filter((item) => item.userId === userId && !item.value.isRead).length;
  }

  pushNotification(
    userId: string,
    type: Notification['type'],
    source: UserState,
    entityId: string | null,
    parentEntityId: string | null = null,
    preview: string | null = null,
  ): void {
    if (userId === source.profile.id || !this.users.has(userId)) return;
    const createdAt = this.now();
    let id: string;
    do id = `notification-${this.#notificationSequence++}`;
    while (this.notifications.some((item) => item.value.id === id));
    const value = notificationFixture({
      id,
      type,
      rawType: type,
      actors: [this.actor(source)],
      entityId,
      parentEntityId,
      preview,
      createdAt,
      updatedAt: createdAt,
    });
    this.notifications.unshift({ userId, value });
    for (const transport of this.eventTransports.get(userId) ?? []) {
      if (transport.connected) transport.notification(value, this.unreadCount(userId));
    }
  }

  authUser(request: MockRequest): UserState | undefined {
    const value = request.headers.get('authorization');
    if (!value?.startsWith('Bearer ')) return undefined;
    const sub = decodeToken(value.slice(7))?.sub;
    return typeof sub === 'string' ? this.users.get(sub) : undefined;
  }

  nextPostId(): string {
    let id: string;
    do id = `post-${this.#postSequence++}`;
    while (this.posts.has(id));
    return id;
  }

  nextCommentId(): string {
    let id: string;
    do id = `comment-${this.#commentSequence++}`;
    while (this.comments.has(id));
    return id;
  }

  nextShopOrderNumber(): string {
    let number: string;
    do number = `SHOP-${String(this.#shopOrderSequence++).padStart(6, '0')}`;
    while (this.shopOrders.has(number));
    return number;
  }

  registerEventTransport(user: UserState): MockEventTransport {
    const transport = new MockEventTransport();
    const transports = this.eventTransports.get(user.profile.id) ?? new Set();
    transports.add(transport);
    this.eventTransports.set(user.profile.id, transports);
    return transport;
  }

  snapshot(): MockServerSnapshot {
    return structuredClone({
      users: [...this.users.values()].map((user) => ({
        ...this.myProfile(user),
        subscription: { ...user.profile.subscription },
        following: [...user.following].sort(),
        deactivated: user.deactivated,
      })),
      posts: [...this.posts.values()].map((post) => ({
        ...post,
        likedBy: [...post.likedBy].sort(),
      })),
      comments: [...this.comments.values()].map((comment) => ({
        ...comment,
        likedBy: [...comment.likedBy].sort(),
      })),
      notifications: this.notifications.map((item) => ({
        ...item.value,
        actors: item.value.actors.map((actor) => ({ ...actor })),
        userId: item.userId,
      })),
      shopProducts: [...this.shopProducts.values()],
      shopOrders: [...this.shopOrders.values()],
    });
  }

  /** Валидирует seed полностью и заменяет состояние только после успешной сборки. */
  loadSeed(seed: MockServerSeed | undefined): void {
    const next = buildMockServerSeed(seed, () => this.now());
    this.users = next.users;
    this.posts = next.posts;
    this.comments = next.comments;
    this.notifications = next.notifications;
    this.shopProducts = next.shopProducts;
    this.shopOrders = next.shopOrders;
    this.shopAccess.clear();
    this.shopIdempotency.clear();
    this.#postSequence = next.postSequence;
    this.#commentSequence = next.commentSequence;
    this.#notificationSequence = next.notificationSequence;
    this.#shopOrderSequence = next.shopOrderSequence;
  }
}
