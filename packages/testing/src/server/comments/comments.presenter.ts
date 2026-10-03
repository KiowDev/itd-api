import type { Comment } from 'itd-api';
import { commentFixture } from '../../fixtures/models.fixtures.js';
import type { UserPresenter } from '../users/users.presenter.js';
import type { UserService } from '../users/users.service.js';
import type { UserRecord } from '../users/users.types.js';
import type { CommentService } from './comments.service.js';
import type { CommentRecord } from './comments.types.js';

/** Комментарии в форме ответов API относительно текущего пользователя. @internal */
export class CommentPresenter {
  readonly #users: UserService;
  readonly #comments: CommentService;
  readonly #userPresenter: UserPresenter;

  constructor(users: UserService, comments: CommentService, userPresenter: UserPresenter) {
    this.#users = users;
    this.#comments = comments;
    this.#userPresenter = userPresenter;
  }

  comment(comment: CommentRecord, viewer: UserRecord): Comment {
    const author = this.#users.get(comment.authorId);
    if (!author) throw new Error(`У комментария ${comment.id} нет автора ${comment.authorId}`);
    const replyTo = comment.replyToUserId ? this.#users.get(comment.replyToUserId) : undefined;
    return commentFixture({
      id: comment.id,
      content: comment.content,
      author: this.#userPresenter.reference(author),
      likesCount: comment.likedBy.size,
      repliesCount: this.#comments.activeReplyCount(comment),
      isLiked: comment.likedBy.has(viewer.profile.id),
      createdAt: comment.createdAt,
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
}
