import { NotificationType } from 'itd-api';
import type { NotificationService } from '../notifications/notifications.service.js';
import { MockDomainError } from '../shared/domain.errors.js';
import type { MockStore } from '../store/mock.store.js';
import type { UserRecord } from '../users/users.types.js';
import type { NewPost, PostRecord } from './posts.types.js';

function newestFirst(a: PostRecord, b: PostRecord): number {
  return b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id);
}

/** Посты, их публикация, удаление и реакции. @internal */
export class PostService {
  readonly #store: MockStore;
  readonly #notifications: NotificationService;

  constructor(store: MockStore, notifications: NotificationService) {
    this.#store = store;
    this.#notifications = notifications;
  }

  /** Все активные посты, сначала новые. */
  feed(): PostRecord[] {
    return this.#active(() => true);
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

  edit(post: PostRecord, content: string | undefined): void {
    if (content !== undefined) post.content = content;
    post.editedAt = this.#store.now();
  }

  remove(post: PostRecord): void {
    post.deleted = true;
  }

  restore(post: PostRecord): void {
    post.deleted = false;
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
