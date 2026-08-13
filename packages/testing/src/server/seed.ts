import { type Notification, NotificationType } from 'itd-api';
import { MockServerSeedError } from '../errors.js';
import { notificationFixture, userFixture } from '../fixtures.js';
import type { MockServerSeed } from './contracts.js';
import type {
  BuiltMockServerSeed,
  CommentState,
  NotificationState,
  PostState,
  UserState,
} from './entities.js';

function actor(user: UserState): Notification['actors'][number] {
  return {
    id: user.profile.id,
    username: user.profile.username,
    displayName: user.profile.displayName,
    avatar: user.profile.avatar,
  };
}

function at<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) {
    throw new MockServerSeedError('Не удалось разобрать исходные данные');
  }
  return value;
}

function requireUnique(ids: readonly string[], kind: string): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) throw new MockServerSeedError(`Повторяется ${kind} ${id}`);
    seen.add(id);
  }
}

/** Валидирует seed и собирает независимое состояние, не изменяя работающий сервер. @internal */
export function buildMockServerSeed(
  seed: MockServerSeed | undefined,
  now: () => string,
): BuiltMockServerSeed {
  const userSeeds = seed?.users ?? [{}];
  const postSeeds = seed?.posts ?? [];
  const commentSeeds = seed?.comments ?? [];
  const notificationSeeds = seed?.notifications ?? [];
  const shopProducts = new Map(
    (seed?.shopProducts ?? []).map((item) => [item.id, structuredClone(item)]),
  );
  const shopOrders = new Map(
    (seed?.shopOrders ?? []).map((item) => [item.value.number, structuredClone(item)]),
  );
  const userIds = userSeeds.map(
    (item, index) => item.id ?? `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  );
  const usernames = userSeeds.map((item, index) => item.username ?? `test-user-${index + 1}`);
  const postIds = postSeeds.map((item, index) => item.id ?? `post-${index + 1}`);
  const commentIds = commentSeeds.map((item, index) => item.id ?? `comment-${index + 1}`);
  const notificationIds = notificationSeeds.map(
    (item, index) => item.id ?? `notification-${index + 1}`,
  );

  requireUnique(userIds, 'пользователь');
  requireUnique(usernames, 'имя пользователя');
  requireUnique(postIds, 'пост');
  requireUnique(commentIds, 'комментарий');
  requireUnique(notificationIds, 'уведомление');
  requireUnique([...shopProducts.keys()], 'товар магазина');
  requireUnique([...shopOrders.keys()], 'заказ магазина');

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
      throw new MockServerSeedError(`У комментария ${commentIds[index]} нет поста ${item.postId}`);
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

  const users = new Map<string, UserState>();
  const posts = new Map<string, PostState>();
  const comments = new Map<string, CommentState>();
  const notifications: NotificationState[] = [];
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
    users.set(id, { profile, following: new Set(following), deactivated });
  });
  postSeeds.forEach((item, index) => {
    const id = at(postIds, index);
    posts.set(id, {
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
    comments.set(id, {
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
      .map((id) => users.get(id))
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
    notifications.push({ userId: item.userId, value });
  });

  return {
    users,
    posts,
    comments,
    notifications,
    shopProducts,
    shopOrders,
    postSequence: postIds.length + 1,
    commentSequence: commentIds.length + 1,
    notificationSequence: notificationIds.length + 1,
    shopOrderSequence: shopOrders.size + 1,
  };
}
