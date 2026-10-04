import { NotificationType } from 'itd-api';
import { userFixture } from '../../fixtures/models.fixtures.js';
import { MockServerSeedError } from '../../testing.errors.js';
import type { CommentRecord } from '../comments/comments.types.js';
import type { NotificationRecord } from '../notifications/notifications.types.js';
import type { PostRecord } from '../posts/posts.types.js';
import type { MockPostSeed, MockServerSeed } from '../server.types.js';
import type { UserRecord } from '../users/users.types.js';
import { isImageAvatar, isUsernameFormatValid, usernameKey } from '../users/users.utils.js';
import type { MockStoreContents } from './store.types.js';

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

/** Цепочка репостов не может замыкаться на себя. */
function requireAcyclicReposts(
  postSeeds: readonly MockPostSeed[],
  postIds: readonly string[],
): void {
  const parents = new Map(postIds.map((id, index) => [id, at(postSeeds, index).originalPostId]));
  for (const start of postIds) {
    const seen = new Set<string>();
    for (let id: string | null | undefined = start; id; id = parents.get(id)) {
      if (seen.has(id)) throw new MockServerSeedError(`Репосты образуют цикл через пост ${id}`);
      seen.add(id);
    }
  }
}

/** Автор держит не больше одного активного репоста одного поста. */
function requireSingleActiveRepost(postSeeds: readonly MockPostSeed[]): void {
  const reposts = new Set<string>();
  for (const item of postSeeds) {
    if (!item.originalPostId || item.deleted) continue;
    const key = JSON.stringify([item.authorId, item.originalPostId]);
    if (reposts.has(key)) {
      throw new MockServerSeedError(
        `Пользователь ${item.authorId} репостнул пост ${item.originalPostId} больше одного раза`,
      );
    }
    reposts.add(key);
  }
}

/** Валидирует seed и собирает независимые данные хранилища, не изменяя работающий сервер. @internal */
export function buildStoreContents(
  seed: MockServerSeed | undefined,
  now: () => string,
): MockStoreContents {
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
  const usernames = userSeeds.map((item, index) => item.username ?? `test_user_${index + 1}`);
  const postIds = postSeeds.map((item, index) => item.id ?? `post-${index + 1}`);
  const commentIds = commentSeeds.map((item, index) => item.id ?? `comment-${index + 1}`);
  const notificationIds = notificationSeeds.map(
    (item, index) => item.id ?? `notification-${index + 1}`,
  );

  requireUnique(userIds, 'пользователь');
  for (const username of usernames) {
    if (!isUsernameFormatValid(username)) {
      throw new MockServerSeedError(
        `Имя пользователя ${username} должно состоять из латинских букв, цифр и _, от 3 до 32 символов`,
      );
    }
  }
  requireUnique(usernames.map(usernameKey), 'имя пользователя');
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
    for (const reference of [usernameKey(id), usernameKey(at(usernames, index))]) {
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
    if (item.originalPostId && !knownPosts.has(item.originalPostId)) {
      throw new MockServerSeedError(
        `Пост ${postIds[index]} репостит отсутствующий пост ${item.originalPostId}`,
      );
    }
  });
  requireAcyclicReposts(postSeeds, postIds);
  requireSingleActiveRepost(postSeeds);
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

  const users = new Map<string, UserRecord>();
  const posts = new Map<string, PostRecord>();
  const comments = new Map<string, CommentRecord>();
  const notifications: NotificationRecord[] = [];
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
    if (profile.clanAvatar === undefined && !isImageAvatar(profile.avatar)) {
      profile.clanAvatar = profile.avatar;
    }
    users.set(id, { profile, following: new Set(following), deactivated });
  });
  postSeeds.forEach((item, index) => {
    const id = at(postIds, index);
    posts.set(id, {
      id,
      authorId: item.authorId,
      content: item.content ?? '',
      spans: structuredClone([...(item.spans ?? [])]),
      originalPostId: item.originalPostId ?? null,
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
    notifications.push({
      id: at(notificationIds, index),
      userId: item.userId,
      type: item.type ?? NotificationType.PostReaction,
      actorIds: [...(item.actorIds ?? [])],
      entityId: item.entityId ?? null,
      parentEntityId: item.parentEntityId ?? null,
      preview: item.preview ?? null,
      isRead: item.isRead ?? false,
      createdAt,
      updatedAt: createdAt,
    });
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
