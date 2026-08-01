import {
  type ItdClientOptions,
  type ItdClock,
  type MyProfile,
  type Notification,
  NotificationType,
  type Post,
  type PublicProfile,
  systemClock,
} from 'itd-api';
import { HttpMethod } from './constants.js';
import { MockServerSeedError } from './errors.js';
import {
  accessTokenFixture,
  commentFixture,
  notificationFixture,
  postFixture,
  publicProfileFixture,
  userFixture,
} from './fixtures.js';
import { MockRealtimeTransport } from './realtime.js';
import {
  type MockRequest,
  type RecordedRequest,
  readMockRequest,
  recordRequest,
} from './request.js';
import { apiErrorResponse, apiResponse, emptyResponse, jsonResponse } from './responses.js';
import {
  compileRoute,
  defineRoute,
  type MockHandler,
  type MockRoute,
  matchRoute,
} from './router.js';

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

export interface MockServerSeed {
  users?: readonly MockUserSeed[];
  posts?: readonly MockPostSeed[];
  comments?: readonly MockCommentSeed[];
  notifications?: readonly MockNotificationSeed[];
}

export interface CreateMockServerOptions {
  seed?: MockServerSeed;
  clock?: ItdClock;
  baseUrl?: string;
}

interface UserState {
  profile: MyProfile;
  following: Set<string>;
  deactivated: boolean;
}

interface PostState {
  id: string;
  authorId: string;
  content: string;
  wallRecipientId: string | null;
  createdAt: string;
  editedAt: string | null;
  likedBy: Set<string>;
  deleted: boolean;
}

interface CommentState {
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

interface RegisteredHandler {
  route: MockRoute;
  compiled: ReturnType<typeof compileRoute>;
  handler: MockHandler;
}

export interface MockServerSnapshot {
  readonly users: readonly MockUserSnapshot[];
  readonly posts: readonly MockPostSnapshot[];
  readonly comments: readonly MockCommentSnapshot[];
  readonly notifications: readonly MockNotificationSnapshot[];
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
  realtime(options: MockServerClientOptions): MockRealtimeTransport;
  assertNoUnsupportedRequests(): void;
  clearRequests(): void;
}

function objectBody(request: MockRequest): Record<string, unknown> {
  return typeof request.json === 'object' && request.json !== null && !Array.isArray(request.json)
    ? (request.json as Record<string, unknown>)
    : {};
}

function positiveInt(value: string | null, fallback: number, maximum = 100): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

function cursorPage<T>(
  items: readonly T[],
  request: MockRequest,
): { items: T[]; next: string | null; hasMore: boolean; limit: number } {
  const limit = positiveInt(request.query.get('limit'), 20);
  const offset = Math.max(0, Number.parseInt(request.query.get('cursor') ?? '0', 10) || 0);
  const page = items.slice(offset, offset + limit);
  const nextOffset = offset + page.length;
  return {
    items: page,
    next: nextOffset < items.length ? String(nextOffset) : null,
    hasMore: nextOffset < items.length,
    limit,
  };
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

/** Создаёт сервер API в памяти. Он принимает обычный `fetch`, но не открывает порт. */
export function createMockServer(options: CreateMockServerOptions = {}): MockServer {
  const clock = options.clock ?? systemClock;
  const baseUrl = (options.baseUrl ?? 'https://mock.itd.test').replace(/\/$/, '');
  let users = new Map<string, UserState>();
  let posts = new Map<string, PostState>();
  let comments = new Map<string, CommentState>();
  let notifications: NotificationState[] = [];
  const requests: RecordedRequest[] = [];
  const unsupported: RecordedRequest[] = [];
  const overrides: RegisteredHandler[] = [];
  const failures: RegisteredHandler[] = [];
  const realtime = new Map<string, Set<MockRealtimeTransport>>();
  let initialSeed = options.seed;
  let postSequence = 1;
  let commentSequence = 1;
  let notificationSequence = 1;
  let requestSequence = 0;

  const now = () => new Date(clock.now()).toISOString();
  const findUser = (reference: string): UserState | undefined =>
    users.get(reference) ?? [...users.values()].find((item) => item.profile.username === reference);

  const actor = (user: UserState) => ({
    id: user.profile.id,
    username: user.profile.username,
    displayName: user.profile.displayName,
    avatar: user.profile.avatar,
  });

  const activePostsBy = (userId: string) =>
    [...posts.values()].filter((post) => !post.deleted && post.authorId === userId).length;
  const followersOf = (userId: string) =>
    [...users.values()].filter((user) => user.following.has(userId)).length;

  const myProfile = (user: UserState): MyProfile => ({
    ...user.profile,
    followersCount: followersOf(user.profile.id),
    followingCount: user.following.size,
    postsCount: activePostsBy(user.profile.id),
    subscription: { ...user.profile.subscription },
  });

  const publicProfile = (viewer: UserState, user: UserState): PublicProfile =>
    publicProfileFixture({
      ...user.profile,
      followersCount: followersOf(user.profile.id),
      followingCount: user.following.size,
      postsCount: activePostsBy(user.profile.id),
      isFollowing: viewer.following.has(user.profile.id),
      isFollowedBy: user.following.has(viewer.profile.id),
    });

  const postModel = (state: PostState, viewer: UserState): Post => {
    const authorState = users.get(state.authorId);
    if (!authorState) throw new Error(`У поста ${state.id} нет автора ${state.authorId}`);
    return postFixture({
      id: state.id,
      content: state.content,
      author: actor(authorState),
      wallRecipientId: state.wallRecipientId,
      likesCount: state.likedBy.size,
      commentsCount: [...comments.values()].filter(
        (comment) => comment.postId === state.id && !comment.deleted,
      ).length,
      isLiked: state.likedBy.has(viewer.profile.id),
      isOwner: state.authorId === viewer.profile.id,
      editedAt: state.editedAt,
      createdAt: state.createdAt,
    });
  };

  const commentModel = (state: CommentState, viewer: UserState) => {
    const authorState = users.get(state.authorId);
    if (!authorState) throw new Error(`У комментария ${state.id} нет автора ${state.authorId}`);
    const replyTo = state.replyToUserId ? users.get(state.replyToUserId) : undefined;
    return commentFixture({
      id: state.id,
      content: state.content,
      author: actor(authorState),
      likesCount: state.likedBy.size,
      repliesCount: [...comments.values()].filter(
        (item) => item.parentCommentId === state.id && !item.deleted,
      ).length,
      isLiked: state.likedBy.has(viewer.profile.id),
      createdAt: state.createdAt,
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
  };

  const unreadCount = (userId: string) =>
    notifications.filter((item) => item.userId === userId && !item.value.isRead).length;

  const pushNotification = (
    userId: string,
    type: Notification['type'],
    source: UserState,
    entityId: string | null,
    parentEntityId: string | null = null,
    preview: string | null = null,
  ): void => {
    if (userId === source.profile.id || !users.has(userId)) return;
    const createdAt = now();
    let id: string;
    do id = `notification-${notificationSequence++}`;
    while (notifications.some((item) => item.value.id === id));
    const value = notificationFixture({
      id,
      type,
      rawType: type,
      actors: [actor(source)],
      entityId,
      parentEntityId,
      preview,
      createdAt,
      updatedAt: createdAt,
    });
    notifications.unshift({ userId, value });
    for (const transport of realtime.get(userId) ?? []) {
      if (transport.connected) transport.notification(value, unreadCount(userId));
    }
  };

  const loadSeed = (seed: MockServerSeed | undefined): void => {
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
      if (value === undefined)
        throw new MockServerSeedError('Не удалось разобрать исходные данные');
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
        createdAt: item.createdAt ?? now(),
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
        createdAt: item.createdAt ?? now(),
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
        createdAt: item.createdAt ?? now(),
        likedBy: new Set(item.likedBy),
        deleted: item.deleted ?? false,
      });
    });

    notificationSeeds.forEach((item, index) => {
      const createdAt = item.createdAt ?? now();
      const actors = (item.actorIds ?? [])
        .map((id) => nextUsers.get(id))
        .filter((user): user is UserState => user !== undefined)
        .map(actor);
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

    users = nextUsers;
    posts = nextPosts;
    comments = nextComments;
    notifications = nextNotifications;
    postSequence = postIds.length + 1;
    commentSequence = commentIds.length + 1;
    notificationSequence = notificationIds.length + 1;
  };

  const authUser = (request: MockRequest): UserState | undefined => {
    const value = request.headers.get('authorization');
    if (!value?.startsWith('Bearer ')) return undefined;
    const sub = decodeToken(value.slice(7))?.sub;
    return typeof sub === 'string' ? users.get(sub) : undefined;
  };

  const routes: RegisteredHandler[] = [];
  const route = (method: string, path: string, handler: MockHandler): void => {
    const descriptor = defineRoute(method, path);
    routes.push({ route: descriptor, compiled: compileRoute(descriptor), handler });
  };

  const requireAuth =
    (
      handler: (request: MockRequest, user: UserState) => Response | Promise<Response>,
    ): MockHandler =>
    (request) => {
      const user = authUser(request);
      return user
        ? handler(request, user)
        : apiErrorResponse(401, 'UNAUTHORIZED', 'Нужна авторизация');
    };

  const ownPost = (request: MockRequest, user: UserState): PostState | Response => {
    const state = posts.get(request.params.postId ?? '');
    if (!state) return apiErrorResponse(404, 'POST_NOT_FOUND', 'Пост не найден');
    if (state.authorId !== user.profile.id)
      return apiErrorResponse(403, 'FORBIDDEN', 'Пост принадлежит другому пользователю');
    return state;
  };

  const ownComment = (request: MockRequest, user: UserState): CommentState | Response => {
    const state = comments.get(request.params.commentId ?? '');
    if (!state) return apiErrorResponse(404, 'COMMENT_NOT_FOUND', 'Комментарий не найден');
    if (state.authorId !== user.profile.id)
      return apiErrorResponse(403, 'FORBIDDEN', 'Комментарий принадлежит другому пользователю');
    return state;
  };

  route(
    HttpMethod.Get,
    '/api/users/me',
    requireAuth((_request, user) => apiResponse(myProfile(user))),
  );
  route(
    HttpMethod.Put,
    '/api/users/me',
    requireAuth((request, user) => {
      const body = objectBody(request);
      for (const key of ['username', 'displayName', 'avatar', 'bio'] as const) {
        if (typeof body[key] === 'string') user.profile[key] = body[key];
      }
      if (body.bannerId === null) user.profile.banner = null;
      return apiResponse(myProfile(user));
    }),
  );
  route(
    HttpMethod.Delete,
    '/api/users/me',
    requireAuth((_request, user) => {
      user.deactivated = true;
      return emptyResponse();
    }),
  );
  route(
    HttpMethod.Post,
    '/api/users/me/restore',
    requireAuth((_request, user) => {
      user.deactivated = false;
      return emptyResponse();
    }),
  );
  route(
    HttpMethod.Get,
    '/api/users/:user',
    requireAuth((request, viewer) => {
      const user = findUser(request.params.user ?? '');
      return user
        ? apiResponse(publicProfile(viewer, user))
        : apiErrorResponse(404, 'USER_NOT_FOUND', 'Пользователь не найден');
    }),
  );
  route(
    HttpMethod.Post,
    '/api/users/:user/follow',
    requireAuth((request, viewer) => {
      const target = findUser(request.params.user ?? '');
      if (!target) return apiErrorResponse(404, 'USER_NOT_FOUND', 'Пользователь не найден');
      if (target.profile.id === viewer.profile.id)
        return apiErrorResponse(400, 'CANNOT_FOLLOW_SELF', 'Нельзя подписаться на себя');
      viewer.following.add(target.profile.id);
      pushNotification(target.profile.id, NotificationType.Follow, viewer, viewer.profile.id);
      return apiResponse({ following: true, followersCount: followersOf(target.profile.id) });
    }),
  );
  route(
    HttpMethod.Delete,
    '/api/users/:user/follow',
    requireAuth((request, viewer) => {
      const target = findUser(request.params.user ?? '');
      if (!target) return apiErrorResponse(404, 'USER_NOT_FOUND', 'Пользователь не найден');
      viewer.following.delete(target.profile.id);
      return emptyResponse();
    }),
  );

  route(
    HttpMethod.Get,
    '/api/posts',
    requireAuth((request, viewer) => {
      const sorted = [...posts.values()]
        .filter((post) => !post.deleted)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
      const page = cursorPage(sorted, request);
      return apiResponse({
        posts: page.items.map((item) => postModel(item, viewer)),
        pagination: { hasMore: page.hasMore, nextCursor: page.next, limit: page.limit },
      });
    }),
  );
  route(
    HttpMethod.Get,
    '/api/posts/user/:user',
    requireAuth((request, viewer) => {
      const target = findUser(request.params.user ?? '');
      if (!target) return apiErrorResponse(404, 'USER_NOT_FOUND', 'Пользователь не найден');
      const sorted = [...posts.values()]
        .filter(
          (post) => !post.deleted && (post.wallRecipientId ?? post.authorId) === target.profile.id,
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
      const page = cursorPage(sorted, request);
      return apiResponse({
        posts: page.items.map((item) => postModel(item, viewer)),
        pagination: { hasMore: page.hasMore, nextCursor: page.next, limit: page.limit },
      });
    }),
  );
  route(
    HttpMethod.Post,
    '/api/posts',
    requireAuth((request, user) => {
      const body = objectBody(request);
      let id: string;
      do id = `post-${postSequence++}`;
      while (posts.has(id));
      const state: PostState = {
        id,
        authorId: user.profile.id,
        content: typeof body.content === 'string' ? body.content : '',
        wallRecipientId: typeof body.wallRecipientId === 'string' ? body.wallRecipientId : null,
        createdAt: now(),
        editedAt: null,
        likedBy: new Set(),
        deleted: false,
      };
      posts.set(id, state);
      if (state.wallRecipientId)
        pushNotification(
          state.wallRecipientId,
          NotificationType.WallPost,
          user,
          id,
          null,
          state.content,
        );
      return apiResponse(postModel(state, user), { status: 201 });
    }),
  );
  route(
    HttpMethod.Get,
    '/api/posts/:postId',
    requireAuth((request, viewer) => {
      const state = posts.get(request.params.postId ?? '');
      return state && !state.deleted
        ? apiResponse(postModel(state, viewer))
        : apiErrorResponse(404, 'POST_NOT_FOUND', 'Пост не найден');
    }),
  );
  route(
    HttpMethod.Put,
    '/api/posts/:postId',
    requireAuth((request, user) => {
      const state = ownPost(request, user);
      if (state instanceof Response) return state;
      const body = objectBody(request);
      if (typeof body.content === 'string') state.content = body.content;
      state.editedAt = now();
      return apiResponse(postModel(state, user));
    }),
  );
  route(
    HttpMethod.Delete,
    '/api/posts/:postId',
    requireAuth((request, user) => {
      const state = ownPost(request, user);
      if (state instanceof Response) return state;
      state.deleted = true;
      return emptyResponse();
    }),
  );
  route(
    HttpMethod.Post,
    '/api/posts/:postId/restore',
    requireAuth((request, user) => {
      const state = ownPost(request, user);
      if (state instanceof Response) return state;
      state.deleted = false;
      return apiResponse(postModel(state, user));
    }),
  );
  const postLike = (liked: boolean): MockHandler =>
    requireAuth((request, user) => {
      const state = posts.get(request.params.postId ?? '');
      if (!state || state.deleted) return apiErrorResponse(404, 'POST_NOT_FOUND', 'Пост не найден');
      if (liked) {
        state.likedBy.add(user.profile.id);
        pushNotification(
          state.authorId,
          NotificationType.PostReaction,
          user,
          state.id,
          null,
          state.content,
        );
      } else state.likedBy.delete(user.profile.id);
      return apiResponse({ liked, likesCount: state.likedBy.size });
    });
  route(HttpMethod.Post, '/api/posts/:postId/like', postLike(true));
  route(HttpMethod.Delete, '/api/posts/:postId/like', postLike(false));

  route(
    HttpMethod.Get,
    '/api/posts/:postId/comments',
    requireAuth((request, viewer) => {
      const post = posts.get(request.params.postId ?? '');
      if (!post || post.deleted) return apiErrorResponse(404, 'POST_NOT_FOUND', 'Пост не найден');
      const sorted = [...comments.values()]
        .filter((item) => item.postId === post.id && item.parentCommentId === null && !item.deleted)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
      const page = cursorPage(sorted, request);
      return apiResponse({
        comments: page.items.map((item) => commentModel(item, viewer)),
        hasMore: page.hasMore,
        nextCursor: page.next,
        total: sorted.length,
      });
    }),
  );
  route(
    HttpMethod.Post,
    '/api/posts/:postId/comments',
    requireAuth((request, user) => {
      const post = posts.get(request.params.postId ?? '');
      if (!post || post.deleted) return apiErrorResponse(404, 'POST_NOT_FOUND', 'Пост не найден');
      const body = objectBody(request);
      let id: string;
      do id = `comment-${commentSequence++}`;
      while (comments.has(id));
      const state: CommentState = {
        id,
        postId: post.id,
        authorId: user.profile.id,
        parentCommentId: null,
        replyToUserId: undefined,
        content: typeof body.content === 'string' ? body.content : '',
        createdAt: now(),
        likedBy: new Set(),
        deleted: false,
      };
      comments.set(id, state);
      pushNotification(
        post.authorId,
        NotificationType.PostComment,
        user,
        id,
        post.id,
        state.content,
      );
      return apiResponse(commentModel(state, user), { status: 201 });
    }),
  );
  route(
    HttpMethod.Get,
    '/api/comments/:commentId/replies',
    requireAuth((request, viewer) => {
      const parent = comments.get(request.params.commentId ?? '');
      if (!parent || parent.deleted)
        return apiErrorResponse(404, 'COMMENT_NOT_FOUND', 'Комментарий не найден');
      const all = [...comments.values()]
        .filter((item) => item.parentCommentId === parent.id && !item.deleted)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
      const pageNumber = positiveInt(request.query.get('page'), 1);
      const limit = positiveInt(request.query.get('limit'), 20);
      const items = all.slice((pageNumber - 1) * limit, pageNumber * limit);
      return apiResponse({
        replies: items.map((item) => commentModel(item, viewer)),
        pagination: {
          page: pageNumber,
          limit,
          total: all.length,
          hasMore: pageNumber * limit < all.length,
        },
      });
    }),
  );
  route(
    HttpMethod.Post,
    '/api/comments/:commentId/replies',
    requireAuth((request, user) => {
      const parent = comments.get(request.params.commentId ?? '');
      if (!parent || parent.deleted)
        return apiErrorResponse(404, 'COMMENT_NOT_FOUND', 'Комментарий не найден');
      const body = objectBody(request);
      const replyToUserId =
        typeof body.replyToUserId === 'string' ? body.replyToUserId : parent.authorId;
      if (!users.has(replyToUserId)) {
        return apiErrorResponse(404, 'USER_NOT_FOUND', 'Адресат ответа не найден');
      }
      let id: string;
      do id = `comment-${commentSequence++}`;
      while (comments.has(id));
      const state: CommentState = {
        id,
        postId: parent.postId,
        authorId: user.profile.id,
        parentCommentId: parent.id,
        replyToUserId,
        content: typeof body.content === 'string' ? body.content : '',
        createdAt: now(),
        likedBy: new Set(),
        deleted: false,
      };
      comments.set(id, state);
      pushNotification(
        replyToUserId,
        NotificationType.CommentReply,
        user,
        id,
        parent.postId,
        state.content,
      );
      return apiResponse(commentModel(state, user), { status: 201 });
    }),
  );
  route(
    HttpMethod.Patch,
    '/api/comments/:commentId',
    requireAuth((request, user) => {
      const state = ownComment(request, user);
      if (state instanceof Response) return state;
      const body = objectBody(request);
      if (typeof body.content === 'string') state.content = body.content;
      return apiResponse(commentModel(state, user));
    }),
  );
  route(
    HttpMethod.Delete,
    '/api/comments/:commentId',
    requireAuth((request, user) => {
      const state = ownComment(request, user);
      if (state instanceof Response) return state;
      state.deleted = true;
      return emptyResponse();
    }),
  );
  route(
    HttpMethod.Post,
    '/api/comments/:commentId/restore',
    requireAuth((request, user) => {
      const state = ownComment(request, user);
      if (state instanceof Response) return state;
      state.deleted = false;
      return apiResponse(commentModel(state, user));
    }),
  );
  const commentLike = (liked: boolean): MockHandler =>
    requireAuth((request, user) => {
      const state = comments.get(request.params.commentId ?? '');
      if (!state || state.deleted)
        return apiErrorResponse(404, 'COMMENT_NOT_FOUND', 'Комментарий не найден');
      if (liked) {
        state.likedBy.add(user.profile.id);
        pushNotification(
          state.authorId,
          NotificationType.CommentReaction,
          user,
          state.id,
          state.postId,
          state.content,
        );
      } else state.likedBy.delete(user.profile.id);
      return apiResponse({ liked, likesCount: state.likedBy.size });
    });
  route(HttpMethod.Post, '/api/comments/:commentId/like', commentLike(true));
  route(HttpMethod.Delete, '/api/comments/:commentId/like', commentLike(false));

  route(
    HttpMethod.Get,
    '/api/notifications/',
    requireAuth((request, user) => {
      const all = notifications
        .filter((item) => item.userId === user.profile.id)
        .map((item) => item.value);
      const offset = Math.max(0, Number.parseInt(request.query.get('offset') ?? '0', 10) || 0);
      const limit = positiveInt(request.query.get('limit'), 20);
      return jsonResponse({
        notifications: all.slice(offset, offset + limit),
        hasMore: offset + limit < all.length,
      });
    }),
  );
  route(
    HttpMethod.Get,
    '/api/notifications/count',
    requireAuth((_request, user) => apiResponse({ count: unreadCount(user.profile.id) })),
  );
  route(
    HttpMethod.Post,
    '/api/notifications/:notificationId/read',
    requireAuth((request, user) => {
      const item = notifications.find(
        (entry) =>
          entry.userId === user.profile.id && entry.value.id === request.params.notificationId,
      );
      if (!item) return apiErrorResponse(404, 'NOTIFICATION_NOT_FOUND', 'Уведомление не найдено');
      const markedCount = item.value.isRead ? 0 : 1;
      item.value = { ...item.value, isRead: true, updatedAt: now() };
      return apiResponse({ markedCount });
    }),
  );
  route(
    HttpMethod.Post,
    '/api/notifications/read-batch',
    requireAuth((request, user) => {
      const ids = objectBody(request).ids;
      const selected = new Set(
        Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [],
      );
      let markedCount = 0;
      for (const item of notifications)
        if (item.userId === user.profile.id && selected.has(item.value.id) && !item.value.isRead) {
          item.value = { ...item.value, isRead: true, updatedAt: now() };
          markedCount += 1;
        }
      return apiResponse({ markedCount });
    }),
  );
  route(
    HttpMethod.Post,
    '/api/notifications/read-all',
    requireAuth((_request, user) => {
      let markedCount = 0;
      for (const item of notifications)
        if (item.userId === user.profile.id && !item.value.isRead) {
          item.value = { ...item.value, isRead: true, updatedAt: now() };
          markedCount += 1;
        }
      return apiResponse({ markedCount });
    }),
  );

  const dispatch = async (
    registered: RegisteredHandler,
    request: Request,
    params: Readonly<Record<string, string>>,
  ): Promise<Response> => {
    const parsed = await readMockRequest(request, params);
    requests.push(recordRequest(parsed, ++requestSequence, clock.now()));
    return (await registered.handler(parsed)).clone();
  };

  const fetchImpl: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const candidates = [...failures, ...overrides, ...routes];
    for (const registered of candidates) {
      const match = matchRoute(registered.compiled, request);
      if (!match) continue;
      if (failures.includes(registered)) failures.splice(failures.indexOf(registered), 1);
      return dispatch(registered, request, match.params);
    }
    const parsed = await readMockRequest(request);
    const recorded = recordRequest(parsed, ++requestSequence, clock.now());
    requests.push(recorded);
    unsupported.push(recorded);
    return apiErrorResponse(
      501,
      'MOCK_ROUTE_NOT_IMPLEMENTED',
      `Mock server не реализует ${request.method} ${new URL(request.url).pathname}`,
    );
  };

  const registerExternal = (
    collection: RegisteredHandler[],
    method: string,
    path: string,
    handler: MockHandler,
  ): RegisteredHandler => {
    const descriptor = defineRoute(method, path);
    const registered = { route: descriptor, compiled: compileRoute(descriptor), handler };
    collection.unshift(registered);
    return registered;
  };

  loadSeed(initialSeed);

  return {
    fetch: fetchImpl,
    get requests() {
      return Object.freeze([...requests]);
    },
    get unsupportedRequests() {
      return Object.freeze([...unsupported]);
    },
    clientOptions({ as }) {
      const user = findUser(as);
      if (!user) throw new Error(`В seed нет пользователя ${as}`);
      return {
        baseUrl,
        fetch: fetchImpl,
        auth: accessTokenFixture({
          userId: user.profile.id,
          issuedAt: Math.floor(clock.now() / 1000),
        }),
        clock,
        retry: false,
        rateLimit: false,
        userAgent: false,
      };
    },
    snapshot() {
      return structuredClone({
        users: [...users.values()].map((user) => ({
          ...myProfile(user),
          subscription: { ...user.profile.subscription },
          following: [...user.following].sort(),
          deactivated: user.deactivated,
        })),
        posts: [...posts.values()].map((post) => ({ ...post, likedBy: [...post.likedBy].sort() })),
        comments: [...comments.values()].map((comment) => ({
          ...comment,
          likedBy: [...comment.likedBy].sort(),
        })),
        notifications: notifications.map((item) => ({
          ...item.value,
          actors: item.value.actors.map((item) => ({ ...item })),
          userId: item.userId,
        })),
      });
    },
    reset(seed = initialSeed) {
      loadSeed(seed);
      initialSeed = seed;
      requests.length = 0;
      unsupported.length = 0;
      failures.length = 0;
      requestSequence = 0;
    },
    failNext(method, path, responder) {
      registerExternal(failures, method, path, async (request) => {
        if (responder instanceof Error) throw responder;
        return responder instanceof Response ? responder.clone() : responder(request);
      });
    },
    override(method, path, handler) {
      const registered = registerExternal(overrides, method, path, handler);
      return () => {
        const index = overrides.indexOf(registered);
        if (index >= 0) overrides.splice(index, 1);
      };
    },
    realtime({ as }) {
      const user = findUser(as);
      if (!user) throw new Error(`В seed нет пользователя ${as}`);
      const transport = new MockRealtimeTransport();
      const transports = realtime.get(user.profile.id) ?? new Set();
      transports.add(transport);
      realtime.set(user.profile.id, transports);
      return transport;
    },
    assertNoUnsupportedRequests() {
      if (unsupported.length > 0) {
        const first = unsupported[0];
        throw new Error(`Mock server не реализует ${first?.method} ${first?.path}`);
      }
    },
    clearRequests() {
      requests.length = 0;
      unsupported.length = 0;
    },
  };
}
