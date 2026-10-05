import type { Comment, CommentUpdateResult, LikeResult } from 'itd-api';
import { commentFixture } from '../../fixtures/models.fixtures.js';
import type { CursorSlice, NumberedSlice } from '../shared/pagination.types.js';
import { numberedPagination } from '../shared/pagination.utils.js';
import type { UserPresenter } from '../users/users.presenter.js';
import type { UserService } from '../users/users.service.js';
import type { UserRecord } from '../users/users.types.js';
import type { CommentService } from './comments.service.js';
import type { CommentPage, CommentRecord, ReplyPage } from './comments.types.js';

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

  /** Страница комментариев первого уровня; `total` — число всех комментариев первого уровня. */
  page(slice: CursorSlice<CommentRecord>, viewer: UserRecord, total: number): CommentPage {
    return {
      comments: slice.items.map((comment) => this.comment(comment, viewer)),
      hasMore: slice.hasMore,
      nextCursor: slice.nextCursor,
      total,
    };
  }

  replyPage(slice: NumberedSlice<CommentRecord>, viewer: UserRecord): ReplyPage {
    return {
      replies: slice.items.map((comment) => this.comment(comment, viewer)),
      pagination: numberedPagination(slice),
    };
  }

  updateResult(comment: CommentRecord, editedAt: string): CommentUpdateResult {
    return { id: comment.id, content: comment.content, editedAt };
  }

  likeResult(comment: CommentRecord, liked: boolean): LikeResult {
    return { liked, likesCount: comment.likedBy.size };
  }

  comment(comment: CommentRecord, viewer: UserRecord): Comment {
    const author = this.#users.get(comment.authorId);
    if (!author) throw new Error(`У комментария ${comment.id} нет автора ${comment.authorId}`);
    const replyTo = comment.replyToUserId ? this.#users.get(comment.replyToUserId) : undefined;
    return commentFixture({
      id: comment.id,
      content: comment.content,
      author: this.#userPresenter.author(author),
      likesCount: comment.likedBy.size,
      repliesCount: this.#comments.activeReplyCount(comment),
      isLiked: comment.likedBy.has(viewer.profile.id),
      createdAt: comment.createdAt,
      ...(replyTo ? { replyTo: this.#userPresenter.replyTo(replyTo) } : {}),
    });
  }
}
