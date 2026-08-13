import { type CommentInput, resolveComment } from '../builders/comment.js';
import type { FileInput } from '../core/attachments/contracts.js';
import type { HttpClient } from '../core/execution/http.js';
import type { PaginationOptions, RequestOptions } from '../core/options.js';
import { encodePathSegment } from '../core/url.js';
import type { Comment, CommentUpdateResult, LikeResult } from '../models/content.js';
import { passthroughOperation, voidOperation } from '../operations/common.js';
import { BaseResource } from './base.js';
import {
  type Page,
  PaginationMode,
  type Paginator,
  pageOperation,
  readPagedPage,
} from './pagination.js';

const COMMENTS_REPLIES = pageOperation<Comment>('comments.replies', (body) =>
  readPagedPage<Comment>(body, 'replies'),
);
const COMMENTS_REPLY = passthroughOperation<Comment>('comments.reply');
const COMMENTS_UPDATE = passthroughOperation<CommentUpdateResult>('comments.update');
const COMMENTS_RESTORE = voidOperation('comments.restore');
const COMMENTS_LIKE = passthroughOperation<LikeResult>('comments.like');
const COMMENTS_UNLIKE = passthroughOperation<LikeResult>('comments.unlike');
const COMMENTS_REMOVE = voidOperation('comments.remove');

/** Параметры запроса ответов на комментарий. */
export interface RepliesParams {
  limit?: number;
  page?: number;
}

/**
 * Комментарии и ответы на них.
 *
 * Доступна как `itd.comments`. Комментарии **к посту** живут в `itd.posts`:
 * `itd.posts.comments()` и `itd.posts.comment()`.
 */
export class CommentsResource extends BaseResource {
  readonly #uploadFiles: (files: FileInput[], options?: RequestOptions) => Promise<string[]>;

  /** Ответы на комментарий: `/api/comments/{id}/replies`, постраничная пагинация. */
  readonly #replies = this.paginated<Comment, RepliesParams & { commentId: string }>({
    operation: COMMENTS_REPLIES,
    path: (p) => `/api/comments/${encodePathSegment(p.commentId, 'commentId')}/replies`,
    query: (p) => ({ limit: p.limit }),
    start: (p) => (p.page !== undefined ? { page: p.page } : {}),
    mode: PaginationMode.Page,
  });

  constructor(
    http: HttpClient,
    deps: { uploadFiles: (files: FileInput[], options?: RequestOptions) => Promise<string[]> },
  ) {
    super(http);
    this.#uploadFiles = deps.uploadFiles;
  }

  /**
   * Загружает страницу ответов на комментарий.
   *
   * Здесь пагинация **постраничная**, в отличие от комментариев к посту, где курсорная.
   */
  replies(
    commentId: string,
    params: RepliesParams = {},
    options: RequestOptions = {},
  ): Promise<Page<Comment>> {
    return this.#replies.list({ ...params, commentId }, options);
  }

  /** Перебирает ответы на комментарий. */
  iterateReplies(
    commentId: string,
    params: RepliesParams = {},
    options: PaginationOptions = {},
  ): Paginator<Comment> {
    return this.#replies.iterate({ ...params, commentId }, options);
  }

  /**
   * Отвечает на комментарий.
   *
   * @example
   * ```ts
   * await itd.comments.reply(commentId, 'согласен');
   * await itd.comments.reply(commentId, (c) => c.content('и вот почему').replyTo(userId));
   * ```
   */
  async reply(
    commentId: string,
    input: CommentInput | string,
    options: RequestOptions = {},
  ): Promise<Comment> {
    const data = resolveComment(typeof input === 'string' ? { content: input } : input, true);

    const existing = data.attachmentIds ?? [];
    const files = data.files ?? [];
    const attachmentIds =
      files.length > 0 ? [...existing, ...(await this.#uploadFiles(files, options))] : existing;

    return this.http.execute(COMMENTS_REPLY, {
      path: `/api/comments/${encodePathSegment(commentId, 'commentId')}/replies`,
      body: {
        content: data.content ?? '',
        attachmentIds,
        ...(data.replyToUserId ? { replyToUserId: data.replyToUserId } : {}),
      },
      ...options,
    });
  }

  /** Редактирует текст комментария. */
  update(
    commentId: string,
    content: string,
    options: RequestOptions = {},
  ): Promise<CommentUpdateResult> {
    return this.http.execute(COMMENTS_UPDATE, {
      path: `/api/comments/${encodePathSegment(commentId, 'commentId')}`,
      body: { content },
      ...options,
    });
  }

  /** Удаляет комментарий. Восстановить его можно через {@link restore}. */
  remove(commentId: string, options: RequestOptions = {}): Promise<void> {
    return this.voidOperation(COMMENTS_REMOVE, {
      path: `/api/comments/${encodePathSegment(commentId, 'commentId')}`,
      ...options,
    });
  }

  /** Восстанавливает удалённый комментарий. */
  restore(commentId: string, options: RequestOptions = {}): Promise<void> {
    return this.voidOperation(COMMENTS_RESTORE, {
      path: `/api/comments/${encodePathSegment(commentId, 'commentId')}/restore`,
      ...options,
    });
  }

  /** Ставит реакцию на комментарий. */
  like(commentId: string, options: RequestOptions = {}): Promise<LikeResult> {
    return this.http.execute(COMMENTS_LIKE, {
      path: `/api/comments/${encodePathSegment(commentId, 'commentId')}/like`,
      ...options,
    });
  }

  /** Убирает реакцию с комментария. */
  unlike(commentId: string, options: RequestOptions = {}): Promise<LikeResult> {
    return this.http.execute(COMMENTS_UNLIKE, {
      path: `/api/comments/${encodePathSegment(commentId, 'commentId')}/like`,
      ...options,
    });
  }
}
