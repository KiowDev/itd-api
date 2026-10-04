import { NotificationType } from 'itd-api';
import type { NotificationService } from '../notifications/notifications.service.js';
import { canAccess } from '../shared/access.utils.js';
import { MockDomainError } from '../shared/domain.errors.js';
import type { MockStore } from '../store/mock.store.js';
import type { UserService } from '../users/users.service.js';
import type { UserRecord } from '../users/users.types.js';
import { clanOf } from '../users/users.utils.js';
import type { NewPost, PostEdit, PostRecord } from './posts.types.js';

function newestFirst(a: PostRecord, b: PostRecord): number {
  return b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id);
}

/** Посты, их публикация, удаление и реакции. @internal */
export class PostService {
  readonly #store: MockStore;
  readonly #users: UserService;
  readonly #notifications: NotificationService;

  constructor(store: MockStore, users: UserService, notifications: NotificationService) {
    this.#store = store;
    this.#users = users;
    this.#notifications = notifications;
  }

  /** Все активные посты, сначала новые. */
  feed(): PostRecord[] {
    return this.#active(() => true);
  }

  /** Активные посты авторов, на которых подписан пользователь. */
  followingFeed(viewer: UserRecord): PostRecord[] {
    return this.#active((post) => viewer.following.has(post.authorId));
  }

  /** Активные посты авторов из клана пользователя (`clanAvatar`), включая его собственные. */
  clanFeed(viewer: UserRecord): PostRecord[] {
    const clan = clanOf(viewer);
    return this.#active((post) => {
      const author = this.#store.users.get(post.authorId);
      return author !== undefined && clanOf(author) === clan;
    });
  }

  /**
   * Активные посты, которые лайкнул владелец списка. Если `likesVisibility` закрывает список
   * от обращающегося, список пуст: прод в этом случае не отвечает ошибкой.
   */
  likedBy(owner: UserRecord, viewer: UserRecord): PostRecord[] {
    const visible = canAccess(owner.profile.likesVisibility, this.#users.relation(owner, viewer));
    return visible ? this.#active((post) => post.likedBy.has(owner.profile.id)) : [];
  }

  /** Активные посты на стене пользователя: свои без адресата и адресованные ему. */
  wall(owner: UserRecord): PostRecord[] {
    return this.#active((post) => (post.wallRecipientId ?? post.authorId) === owner.profile.id);
  }

  activeCountBy(author: UserRecord): number {
    let count = 0;
    for (const post of this.#store.posts.values()) {
      if (!post.deleted && post.authorId === author.profile.id) count += 1;
    }
    return count;
  }

  requireActive(postId: string): PostRecord {
    const post = this.#store.posts.get(postId);
    if (!post || post.deleted) throw MockDomainError.notFound('Post not found');
    return post;
  }

  /** Пост автора, в том числе удалённый: автор может его восстановить. */
  requireOwn(postId: string, author: UserRecord): PostRecord {
    const post = this.#store.posts.get(postId);
    if (!post) throw MockDomainError.notFound('Post not found');
    if (post.authorId !== author.profile.id) {
      throw MockDomainError.forbidden('Пост принадлежит другому пользователю');
    }
    return post;
  }

  create(author: UserRecord, input: NewPost): PostRecord {
    const post: PostRecord = {
      id: this.#store.nextPostId(),
      authorId: author.profile.id,
      content: input.content,
      spans: input.spans,
      originalPostId: null,
      wallRecipientId: input.wallRecipientId,
      createdAt: this.#store.now(),
      editedAt: null,
      likedBy: new Set(),
      deleted: false,
    };
    this.#store.posts.set(post.id, post);
    if (post.wallRecipientId) {
      this.#notifications.notify({
        recipientId: post.wallRecipientId,
        type: NotificationType.WallPost,
        actorId: author.profile.id,
        entityId: post.id,
        preview: post.content,
      });
    }
    return post;
  }

  edit(post: PostRecord, changes: PostEdit): void {
    if (changes.content !== undefined) {
      post.content = changes.content;
      post.spans = changes.spans ?? [];
    } else if (changes.spans !== undefined) {
      post.spans = changes.spans;
    }
    post.editedAt = this.#store.now();
  }

  remove(post: PostRecord): void {
    post.deleted = true;
  }

  restore(post: PostRecord): void {
    post.deleted = false;
  }

  /**
   * Репостит пост с необязательным текстом. Повторный репост того же поста возвращает уже
   * существующий репост без изменений и без нового уведомления. Репост репоста ссылается
   * на сам репост, поэтому цепочка может быть любой длины.
   */
  repost(user: UserRecord, postId: string, content: string): PostRecord {
    const parent = this.requireActive(postId);
    const existing = this.activeRepost(user, parent.id);
    if (existing) return existing;
    const repost: PostRecord = {
      id: this.#store.nextPostId(),
      authorId: user.profile.id,
      content,
      spans: [],
      originalPostId: parent.id,
      wallRecipientId: null,
      createdAt: this.#store.now(),
      editedAt: null,
      likedBy: new Set(),
      deleted: false,
    };
    this.#store.posts.set(repost.id, repost);
    this.#notifications.notify({
      recipientId: parent.authorId,
      type: NotificationType.PostRepost,
      actorId: user.profile.id,
      entityId: repost.id,
      parentEntityId: parent.id,
      preview: parent.content,
    });
    return repost;
  }

  /** Удаляет репост пользователя. Сам пост и чужие репосты не меняются. */
  unrepost(user: UserRecord, postId: string): void {
    const repost = this.activeRepost(user, postId);
    if (!repost) throw MockDomainError.notFound('Repost not found');
    repost.deleted = true;
  }

  /** Активный репост поста от пользователя. */
  activeRepost(user: UserRecord, postId: string): PostRecord | undefined {
    for (const post of this.#store.posts.values()) {
      if (!post.deleted && post.originalPostId === postId && post.authorId === user.profile.id) {
        return post;
      }
    }
    return undefined;
  }

  /** Число активных прямых репостов поста. */
  repostsCount(post: PostRecord): number {
    let count = 0;
    for (const candidate of this.#store.posts.values()) {
      if (!candidate.deleted && candidate.originalPostId === post.id) count += 1;
    }
    return count;
  }

  /** Пост, который репостнули, если он не удалён. */
  activeParent(post: PostRecord): PostRecord | undefined {
    if (!post.originalPostId) return undefined;
    const parent = this.#store.posts.get(post.originalPostId);
    return parent && !parent.deleted ? parent : undefined;
  }

  /** Возвращает `true`, если реакция появилась. Только новая реакция уведомляет автора. */
  like(user: UserRecord, post: PostRecord): boolean {
    if (post.likedBy.has(user.profile.id)) return false;
    post.likedBy.add(user.profile.id);
    this.#notifications.notify({
      recipientId: post.authorId,
      type: NotificationType.PostReaction,
      actorId: user.profile.id,
      entityId: post.id,
      preview: post.content,
    });
    return true;
  }

  /** Возвращает `true`, если реакция была. */
  unlike(user: UserRecord, post: PostRecord): boolean {
    return post.likedBy.delete(user.profile.id);
  }

  #active(predicate: (post: PostRecord) => boolean): PostRecord[] {
    return [...this.#store.posts.values()]
      .filter((post) => !post.deleted && predicate(post))
      .sort(newestFirst);
  }
}
