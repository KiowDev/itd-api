import { NotificationType } from 'itd-api';
import type { NotificationService } from '../notifications/notifications.service.js';
import type { PostRecord } from '../posts/posts.types.js';
import { MockDomainError } from '../shared/domain.errors.js';
import type { MockStore } from '../store/mock.store.js';
import type { UserService } from '../users/users.service.js';
import type { UserRecord } from '../users/users.types.js';
import type { CommentRecord } from './comments.types.js';

function oldestFirst(a: CommentRecord, b: CommentRecord): number {
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

/** Комментарии, ответы и реакции на них. @internal */
export class CommentService {
  readonly #store: MockStore;
  readonly #users: UserService;
  readonly #notifications: NotificationService;

  constructor(store: MockStore, users: UserService, notifications: NotificationService) {
    this.#store = store;
    this.#users = users;
    this.#notifications = notifications;
  }

  /** Активные комментарии первого уровня, сначала старые. */
  topLevel(post: PostRecord): CommentRecord[] {
    return this.#active(
      (comment) => comment.postId === post.id && comment.parentCommentId === null,
    );
  }

  /** Активные ответы на комментарий, сначала старые. */
  replies(parent: CommentRecord): CommentRecord[] {
    return this.#active((comment) => comment.parentCommentId === parent.id);
  }

  activeCountFor(post: PostRecord): number {
    return this.#count((comment) => comment.postId === post.id);
  }

  activeReplyCount(parent: CommentRecord): number {
    return this.#count((comment) => comment.parentCommentId === parent.id);
  }

  /** Видимый комментарий: не удалён, автор не деактивирован. */
  requireActive(commentId: string): CommentRecord {
    const comment = this.#store.comments.get(commentId);
    if (!comment || !this.#visible(comment)) throw MockDomainError.notFound('Comment not found');
    return comment;
  }

  /** Комментарий автора, в том числе удалённый: автор может его восстановить. */
  requireOwn(commentId: string, author: UserRecord): CommentRecord {
    const comment = this.#store.comments.get(commentId);
    if (!comment) throw MockDomainError.notFound('Comment not found');
    if (comment.authorId !== author.profile.id) {
      throw MockDomainError.forbidden('Комментарий принадлежит другому пользователю');
    }
    return comment;
  }

  create(post: PostRecord, author: UserRecord, content: string): CommentRecord {
    const comment = this.#insert({
      postId: post.id,
      authorId: author.profile.id,
      parentCommentId: null,
      replyToUserId: undefined,
      content,
    });
    this.#notifications.notify({
      recipientId: post.authorId,
      type: NotificationType.PostComment,
      actorId: author.profile.id,
      entityId: comment.id,
      parentEntityId: post.id,
      preview: comment.content,
    });
    return comment;
  }

  /**
   * Отвечает на комментарий. Ветки двухуровневые: ответ на ответ встаёт в ветку комментария
   * первого уровня. Без явного адресата ответ адресован автору комментария, на который отвечают.
   */
  reply(
    parent: CommentRecord,
    author: UserRecord,
    content: string,
    replyToUserId: string = parent.authorId,
  ): CommentRecord {
    if (!this.#users.isActive(replyToUserId)) throw MockDomainError.notFound('User not found');
    const reply = this.#insert({
      postId: parent.postId,
      authorId: author.profile.id,
      parentCommentId: parent.parentCommentId ?? parent.id,
      replyToUserId,
      content,
    });
    this.#notifications.notify({
      recipientId: replyToUserId,
      type: NotificationType.CommentReply,
      actorId: author.profile.id,
      entityId: reply.id,
      parentEntityId: parent.postId,
      preview: reply.content,
    });
    return reply;
  }

  /** Возвращает время изменения. */
  edit(comment: CommentRecord, content: string | undefined): string {
    if (content !== undefined) comment.content = content;
    return this.#store.now();
  }

  remove(comment: CommentRecord): void {
    comment.deleted = true;
  }

  restore(comment: CommentRecord): void {
    comment.deleted = false;
  }

  /** Ставит реакцию. Уведомление автор получает только о новой реакции. */
  like(user: UserRecord, comment: CommentRecord): void {
    if (comment.likedBy.has(user.profile.id)) return;
    comment.likedBy.add(user.profile.id);
    this.#notifications.notify({
      recipientId: comment.authorId,
      type: NotificationType.CommentReaction,
      actorId: user.profile.id,
      entityId: comment.id,
      parentEntityId: comment.postId,
      preview: comment.content,
    });
  }

  unlike(user: UserRecord, comment: CommentRecord): void {
    comment.likedBy.delete(user.profile.id);
  }

  #insert(fields: Omit<CommentRecord, 'id' | 'createdAt' | 'likedBy' | 'deleted'>): CommentRecord {
    const comment: CommentRecord = {
      id: this.#store.nextCommentId(),
      ...fields,
      createdAt: this.#store.now(),
      likedBy: new Set(),
      deleted: false,
    };
    this.#store.comments.set(comment.id, comment);
    return comment;
  }

  #active(predicate: (comment: CommentRecord) => boolean): CommentRecord[] {
    return [...this.#store.comments.values()]
      .filter((comment) => this.#visible(comment) && predicate(comment))
      .sort(oldestFirst);
  }

  #count(predicate: (comment: CommentRecord) => boolean): number {
    let count = 0;
    for (const comment of this.#store.comments.values()) {
      if (this.#visible(comment) && predicate(comment)) count += 1;
    }
    return count;
  }

  #visible(comment: CommentRecord): boolean {
    return !comment.deleted && this.#users.isActive(comment.authorId);
  }
}
