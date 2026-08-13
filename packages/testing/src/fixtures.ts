import {
  type Author,
  type Comment,
  type ItdSession,
  LikesVisibility,
  type MyProfile,
  type Notification,
  NotificationType,
  type Page,
  type Post,
  type PublicProfile,
  WallAccess,
} from 'itd-api';

export const FIXTURE_TIME = '2026-08-01T10:00:00.000Z';
export const FIXTURE_USER_ID = '00000000-0000-4000-8000-000000000001';

export type AuthorFixtureInput = Partial<Author>;
export type UserFixtureInput = Partial<MyProfile>;
export type PublicProfileFixtureInput = Partial<PublicProfile>;
export type PostFixtureInput = Partial<Omit<Post, 'author'>> & { author?: AuthorFixtureInput };
export type CommentFixtureInput = Partial<Omit<Comment, 'author'>> & {
  author?: AuthorFixtureInput;
};
export type NotificationFixtureInput = Partial<Omit<Notification, 'actors'>> & {
  actors?: readonly Partial<Notification['actors'][number]>[];
};

/** Автор с устойчивыми значениями по умолчанию. */
export function authorFixture(input: AuthorFixtureInput = {}): Author {
  return {
    id: FIXTURE_USER_ID,
    username: 'test-user',
    displayName: 'Тестовый пользователь',
    avatar: '🧪',
    verified: false,
    ...input,
  };
}

/** Свой профиль с устойчивыми значениями по умолчанию. */
export function userFixture(input: UserFixtureInput = {}): MyProfile {
  return {
    id: FIXTURE_USER_ID,
    username: 'test-user',
    displayName: 'Тестовый пользователь',
    avatar: '🧪',
    banner: null,
    bio: '',
    verified: false,
    wallAccess: WallAccess.Everyone,
    likesVisibility: LikesVisibility.Everyone,
    followersCount: 0,
    followingCount: 0,
    postsCount: 0,
    createdAt: FIXTURE_TIME,
    isPrivate: false,
    isPhoneVerified: true,
    subscription: { isActive: false, expiresAt: null, autoRenewal: false },
    ...input,
  };
}

/** Чужой профиль с устойчивыми значениями по умолчанию. */
export function publicProfileFixture(input: PublicProfileFixtureInput = {}): PublicProfile {
  return {
    id: FIXTURE_USER_ID,
    username: 'test-user',
    displayName: 'Тестовый пользователь',
    avatar: '🧪',
    banner: null,
    bio: '',
    verified: false,
    wallAccess: WallAccess.Everyone,
    likesVisibility: LikesVisibility.Everyone,
    followersCount: 0,
    followingCount: 0,
    postsCount: 0,
    createdAt: FIXTURE_TIME,
    pinnedPostId: null,
    isFollowing: false,
    isFollowedBy: false,
    canMessage: false,
    online: false,
    lastSeen: FIXTURE_TIME,
    ...input,
  };
}

/** Пост с устойчивыми значениями по умолчанию. */
export function postFixture(input: PostFixtureInput = {}): Post {
  const { author, ...fields } = input;
  return {
    id: 'post-1',
    content: 'Тестовая запись',
    spans: [],
    author: authorFixture(author),
    attachments: [],
    likesCount: 0,
    commentsCount: 0,
    repostsCount: 0,
    viewsCount: 0,
    wallRecipientId: null,
    isLiked: false,
    isReposted: false,
    isViewed: false,
    isOwner: false,
    editedAt: null,
    createdAt: FIXTURE_TIME,
    ...fields,
  };
}

/** Комментарий с устойчивыми значениями по умолчанию. */
export function commentFixture(input: CommentFixtureInput = {}): Comment {
  const { author, ...fields } = input;
  return {
    id: 'comment-1',
    content: 'Тестовый комментарий',
    spans: [],
    author: authorFixture(author),
    likesCount: 0,
    repliesCount: 0,
    isLiked: false,
    createdAt: FIXTURE_TIME,
    attachments: [],
    ...fields,
  };
}

/** Уведомление с устойчивыми значениями по умолчанию. */
export function notificationFixture(input: NotificationFixtureInput = {}): Notification {
  const { actors, ...fields } = input;
  return {
    id: 'notification-1',
    type: NotificationType.PostReaction,
    rawType: NotificationType.PostReaction,
    entityId: 'post-1',
    parentEntityId: null,
    isRead: false,
    actors: (actors ?? [authorFixture()]).map((actor) => ({
      id: FIXTURE_USER_ID,
      username: 'test-user',
      displayName: 'Тестовый пользователь',
      avatar: '🧪',
      ...actor,
    })),
    count: Math.max(1, actors?.length ?? 1),
    preview: null,
    createdAt: FIXTURE_TIME,
    updatedAt: FIXTURE_TIME,
    raw: {},
    ...fields,
  };
}

/** Сессия хранилища клиента. */
export function sessionFixture(input: Partial<ItdSession> = {}): ItdSession {
  return {
    accessToken: accessTokenFixture(),
    refreshToken: 'test-refresh-token',
    deviceId: '00000000-0000-4000-8000-000000000099',
    obtainedAt: new Date(FIXTURE_TIME).getTime(),
    ...input,
  };
}

/** Страница результата с согласованными значениями пагинации. */
export function pageFixture<T>(
  items: readonly T[],
  input: Partial<Omit<Page<T>, 'items'>> = {},
): Page<T> {
  return { items: [...items], hasMore: false, raw: {}, ...input };
}

function encodeSegment(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/** Создаёт синтаксически корректный тестовый JWT. Токен не подписан настоящим ключом. */
export function jwtFixture(payload: Readonly<Record<string, unknown>> = {}): string {
  return `${encodeSegment({ alg: 'HS256', typ: 'JWT' })}.${encodeSegment(payload)}.test-signature`;
}

export interface AccessTokenFixtureOptions {
  userId?: string;
  sessionId?: string;
  issuedAt?: number;
  expiresAt?: number;
  payload?: Readonly<Record<string, unknown>>;
}

/** Тестовый токен доступа с идентификаторами пользователя и сессии. */
export function accessTokenFixture(options: AccessTokenFixtureOptions = {}): string {
  const issuedAt = options.issuedAt ?? Math.floor(new Date(FIXTURE_TIME).getTime() / 1000);
  return jwtFixture({
    sub: options.userId ?? FIXTURE_USER_ID,
    sid: options.sessionId ?? 'test-session',
    iat: issuedAt,
    exp: options.expiresAt ?? issuedAt + 31_536_000,
    ...options.payload,
  });
}
