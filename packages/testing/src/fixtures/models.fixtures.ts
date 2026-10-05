import {
  type Author,
  type Comment,
  LikesVisibility,
  type MyProfile,
  type Notification,
  NotificationType,
  type OriginalPost,
  type Page,
  type Post,
  type PublicProfile,
  WallAccess,
} from 'itd-api';
import { FIXTURE_TIME, FIXTURE_USER_ID } from './fixtures.constants.js';
import type {
  AuthorFixtureInput,
  CommentFixtureInput,
  NotificationFixtureInput,
  OriginalPostFixtureInput,
  PostFixtureInput,
  PublicProfileFixtureInput,
  UserFixtureInput,
} from './fixtures.types.js';

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

/** Пост, на который ссылается репост, с устойчивыми значениями по умолчанию. */
export function originalPostFixture(input: OriginalPostFixtureInput = {}): OriginalPost {
  const { author, ...fields } = input;
  return {
    id: 'post-original',
    content: 'Исходная запись',
    spans: [],
    author: authorFixture(author),
    attachments: [],
    likesCount: 0,
    commentsCount: 0,
    repostsCount: 0,
    viewsCount: 0,
    isDeleted: false,
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

/** Страница результата с согласованными значениями пагинации. */
export function pageFixture<T>(
  items: readonly T[],
  input: Partial<Omit<Page<T>, 'items'>> = {},
): Page<T> {
  return { items: [...items], hasMore: false, raw: {}, ...input };
}
