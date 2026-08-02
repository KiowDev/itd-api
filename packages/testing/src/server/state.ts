import {
  type Comment,
  type ItdClock,
  type MyProfile,
  type Notification,
  NotificationType,
  type Post,
  type PublicProfile,
} from 'itd-api';
import { MockServerSeedError } from '../errors.js';
import {
  commentFixture,
  notificationFixture,
  postFixture,
  publicProfileFixture,
  userFixture,
} from '../fixtures.js';
import { MockRealtimeTransport } from '../realtime.js';
import type { MockRequest } from '../request.js';
import type { MockServerSeed, MockServerSnapshot } from './contracts.js';

export interface UserState {
  profile: MyProfile;
  following: Set<string>;
  deactivated: boolean;
}

export interface PostState {
  id: string;
  authorId: string;
  content: string;
  wallRecipientId: string | null;
  createdAt: string;
  editedAt: string | null;
  likedBy: Set<string>;
  deleted: boolean;
}

export interface CommentState {
  id: string;
  postId: string;
  authorId: string;
  parentCommentId: string | null;
  replyToUserId: string | undefined;
  content: string;
  createdAt: string;
  likedBy: Set<string>;
  deleted: boolean;
}

interface NotificationState {
  userId: string;
  value: Notification;
}

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
  readonly realtime = new Map<string, Set<MockRealtimeTransport>>();
  readonly clock: ItdClock;
  #postSequence = 1;
  #commentSequence = 1;
  #notificationSequence = 1;

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
    for (const transport of this.realtime.get(userId) ?? []) {
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

  registerRealtime(user: UserState): MockRealtimeTransport {
    const transport = new MockRealtimeTransport();
    const transports = this.realtime.get(user.profile.id) ?? new Set();
    transports.add(transport);
    this.realtime.set(user.profile.id, transports);
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
    });
  }

  /** Валидирует seed полностью и заменяет состояние только после успешной сборки. */
  loadSeed(seed: MockServerSeed | undefined): void {
    const userSeeds = seed?.users ?? [{}];
    const postSeeds = seed?.posts ?? [];
    const commentSeeds = seed?.comments ?? [];
    const notificationSeeds = seed?.notifications ?? [];
    const userIds = userSeeds.map(
      (item, index) => item.id ?? `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    );
    const usernames = userSeeds.map((item, index) => item.username ?? `test-user-${index + 1}`);
    const postIds = postSeeds.map((item, index) => item.id ?? `post-${index + 1}`);
    const commentIds = commentSeeds.map((item, index) => item.id ?? `comment-${index + 1}`);
    const notificationIds = notificationSeeds.map(
      (item, index) => item.id ?? `notification-${index + 1}`,
    );
    const at = <T>(values: readonly T[], index: number): T => {
      const value = values[index];
      if (value === undefined) {
        throw new MockServerSeedError('Не удалось разобрать исходные данные');
      }
      return value;
    };
    const requireUnique = (ids: readonly string[], kind: string): void => {
      const seen = new Set<string>();
      for (const id of ids) {
        if (seen.has(id)) throw new MockServerSeedError(`Повторяется ${kind} ${id}`);
        seen.add(id);
      }
    };

    requireUnique(userIds, 'пользователь');
    requireUnique(usernames, 'имя пользователя');
    requireUnique(postIds, 'пост');
    requireUnique(commentIds, 'комментарий');
    requireUnique(notificationIds, 'уведомление');

    const knownUsers = new Set(userIds);
    const knownPosts = new Set(postIds);
    const knownComments = new Set(commentIds);
    const commentPostIds = new Map(
      commentIds.map((id, index) => [id, at(commentSeeds, index).postId]),
    );
    const userReferences = new Map<string, string>();
    userIds.forEach((id, index) => {
      for (const reference of [id, at(usernames, index)]) {
        const owner = userReferences.get(reference);
        if (owner !== undefined && owner !== id) {
          throw new MockServerSeedError(
            `Значение ${reference} одновременно обозначает разных пользователей ${owner} и ${id}`,
          );
        }
        userReferences.set(reference, id);
      }
    });

    const requireKnownUsers = (references: readonly string[], owner: string): void => {
      for (const reference of references) {
        if (!knownUsers.has(reference)) {
          throw new MockServerSeedError(
            `${owner} ссылается на отсутствующего пользователя ${reference}`,
          );
        }
      }
    };

    userSeeds.forEach((item, index) => {
      for (const followed of item.following ?? []) {
        if (!knownUsers.has(followed)) {
          throw new MockServerSeedError(
            `Пользователь ${userIds[index]} подписан на отсутствующего пользователя ${followed}`,
          );
        }
      }
    });
    postSeeds.forEach((item, index) => {
      if (!knownUsers.has(item.authorId)) {
        throw new MockServerSeedError(`У поста ${postIds[index]} нет автора ${item.authorId}`);
      }
      if (item.wallRecipientId && !knownUsers.has(item.wallRecipientId)) {
        throw new MockServerSeedError(
          `У поста ${postIds[index]} нет владельца стены ${item.wallRecipientId}`,
        );
      }
      requireKnownUsers(item.likedBy ?? [], `Пост ${postIds[index]}`);
    });
    commentSeeds.forEach((item, index) => {
      if (!knownPosts.has(item.postId)) {
        throw new MockServerSeedError(
          `У комментария ${commentIds[index]} нет поста ${item.postId}`,
        );
      }
      if (!knownUsers.has(item.authorId)) {
        throw new MockServerSeedError(
          `У комментария ${commentIds[index]} нет автора ${item.authorId}`,
        );
      }
      if (item.parentCommentId && !knownComments.has(item.parentCommentId)) {
        throw new MockServerSeedError(
          `У комментария ${commentIds[index]} нет родительского комментария ${item.parentCommentId}`,
        );
      }
      if (item.parentCommentId && commentPostIds.get(item.parentCommentId) !== item.postId) {
        throw new MockServerSeedError(
          `Родительский комментарий ${item.parentCommentId} относится к другому посту`,
        );
      }
      if (item.replyToUserId && !knownUsers.has(item.replyToUserId)) {
        throw new MockServerSeedError(
          `Комментарий ${commentIds[index]} адресован отсутствующему пользователю ${item.replyToUserId}`,
        );
      }
      requireKnownUsers(item.likedBy ?? [], `Комментарий ${commentIds[index]}`);
    });
    for (const item of notificationSeeds) {
      if (!knownUsers.has(item.userId)) {
        throw new MockServerSeedError(
          `Уведомление принадлежит отсутствующему пользователю ${item.userId}`,
        );
      }
      for (const actorId of item.actorIds ?? []) {
        if (!knownUsers.has(actorId)) {
          throw new MockServerSeedError(`В уведомлении указан отсутствующий участник ${actorId}`);
        }
      }
    }

    const nextUsers = new Map<string, UserState>();
    const nextPosts = new Map<string, PostState>();
    const nextComments = new Map<string, CommentState>();
    const nextNotifications: NotificationState[] = [];
    userSeeds.forEach((item, index) => {
      const { following = [], deactivated = false, ...fields } = item;
      const id = at(userIds, index);
      const profile = userFixture({
        id,
        username: at(usernames, index),
        displayName: item.displayName ?? `Тестовый пользователь ${index + 1}`,
        createdAt: item.createdAt ?? this.now(),
        ...fields,
      });
      nextUsers.set(id, { profile, following: new Set(following), deactivated });
    });
    postSeeds.forEach((item, index) => {
      const id = at(postIds, index);
      nextPosts.set(id, {
        id,
        authorId: item.authorId,
        content: item.content ?? '',
        wallRecipientId: item.wallRecipientId ?? null,
        createdAt: item.createdAt ?? this.now(),
        editedAt: null,
        likedBy: new Set(item.likedBy),
        deleted: item.deleted ?? false,
      });
    });
    commentSeeds.forEach((item, index) => {
      const id = at(commentIds, index);
      nextComments.set(id, {
        id,
        postId: item.postId,
        authorId: item.authorId,
        parentCommentId: item.parentCommentId ?? null,
        replyToUserId: item.replyToUserId,
        content: item.content ?? '',
        createdAt: item.createdAt ?? this.now(),
        likedBy: new Set(item.likedBy),
        deleted: item.deleted ?? false,
      });
    });
    notificationSeeds.forEach((item, index) => {
      const createdAt = item.createdAt ?? this.now();
      const actors = (item.actorIds ?? [])
        .map((id) => nextUsers.get(id))
        .filter((user): user is UserState => user !== undefined)
        .map((user) => this.actor(user));
      const value = notificationFixture({
        id: at(notificationIds, index),
        type: item.type ?? NotificationType.PostReaction,
        rawType: item.type ?? NotificationType.PostReaction,
        actors,
        entityId: item.entityId ?? null,
        parentEntityId: item.parentEntityId ?? null,
        preview: item.preview ?? null,
        isRead: item.isRead ?? false,
        createdAt,
        updatedAt: createdAt,
      });
      nextNotifications.push({ userId: item.userId, value });
    });

    this.users = nextUsers;
    this.posts = nextPosts;
    this.comments = nextComments;
    this.notifications = nextNotifications;
    this.#postSequence = postIds.length + 1;
    this.#commentSequence = commentIds.length + 1;
    this.#notificationSequence = notificationIds.length + 1;
  }
}
