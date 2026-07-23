import { type CommentInput, resolveComment } from '../builders/comment.js';
import type { HttpClient } from '../core/http.js';
import { type Page, PaginationMode, type Paginator, readPagedPage } from '../core/pagination.js';
import { encodePathSegment } from '../core/url.js';
import type { Comment, LikeResult } from '../types/models.js';
import type { RequestOptions } from '../types/options.js';
import type { FileInput } from '../types/params.js';
import { BaseResource } from './base.js';

/** Параметры запроса ответов на комментарий. */
export interface RepliesParams extends RequestOptions {
  limit?: number;
  page?: number;
  maxPages?: number;
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
    path: (p) => `/api/comments/${encodePathSegment(p.commentId, 'commentId')}/replies`,
    query: (p) => ({ limit: p.limit }),
    start: (p) => (p.page !== undefined ? { page: p.page } : {}),
    read: (body) => readPagedPage<Comment>(body, 'replies'),
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
  replies(commentId: string, params: RepliesParams = {}): Promise<Page<Comment>> {
    return this.#replies.list({ ...params, commentId });
  }

  /** Перебирает ответы на комментарий. */
  iterateReplies(commentId: string, params: RepliesParams = {}): Paginator<Comment> {
    return this.#replies.iterate({ ...params, commentId });
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

    return this.http.request<Comment>({
      method: 'POST',
      path: `/api/comments/${encodePathSegment(commentId, 'commentId')}/replies`,
      body: {
        content: data.content ?? '',
        attachmentIds,
        ...(data.replyToUserId ? { replyToUserId: data.replyToUserId } : {}),
      },
      ...this.requestOptions(options),
    });
  }

  /** Редактирует текст комментария. */
  update(commentId: string, content: string, options: RequestOptions = {}): Promise<Comment> {
    return this.http.request<Comment>({
      method: 'PATCH',
      path: `/api/comments/${encodePathSegment(commentId, 'commentId')}`,
      body: { content },
      ...this.requestOptions(options),
    });
  }

  /** Удаляет комментарий. Восстановить его можно через {@link restore}. */
  remove(commentId: string, options: RequestOptions = {}): Promise<void> {
    return this.http.request<void>({
      method: 'DELETE',
      path: `/api/comments/${encodePathSegment(commentId, 'commentId')}`,
      ...this.requestOptions(options),
    });
  }

  /** Восстанавливает удалённый комментарий. */
  restore(commentId: string, options: RequestOptions = {}): Promise<Comment> {
    return this.http.request<Comment>({
      method: 'POST',
      path: `/api/comments/${encodePathSegment(commentId, 'commentId')}/restore`,
      ...this.requestOptions(options),
    });
  }

  /** Ставит реакцию на комментарий. */
  like(commentId: string, options: RequestOptions = {}): Promise<LikeResult> {
    return this.http.request<LikeResult>({
      method: 'POST',
      path: `/api/comments/${encodePathSegment(commentId, 'commentId')}/like`,
      ...this.requestOptions(options),
    });
  }

  /** Убирает реакцию с комментария. */
  unlike(commentId: string, options: RequestOptions = {}): Promise<LikeResult> {
    return this.http.request<LikeResult>({
      method: 'DELETE',
      path: `/api/comments/${encodePathSegment(commentId, 'commentId')}/like`,
      ...this.requestOptions(options),
    });
  }
}
