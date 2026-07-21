import { type CommentInput, resolveComment } from '../builders/comment.js';
import { type PostInput, resolvePost } from '../builders/post.js';
import type { HttpClient } from '../core/http.js';
import {
  type Page,
  type PageState,
  type Paginator,
  readCursorPage,
  readFlatCursorPage,
} from '../core/pagination.js';
import { pickArray } from '../core/unwrap.js';
import { encodePathSegment } from '../core/url.js';
import type { CommentSort, FeedTab } from '../types/enums.js';
import type {
  Comment,
  LikeResult,
  PinPostResult,
  Poll,
  Post,
  PostStats,
  UserRef,
} from '../types/models.js';
import type { RequestOptions } from '../types/options.js';
import type { CreateCommentInput, CreatePostInput, FileInput } from '../types/params.js';
import { BaseResource, withPageState } from './base.js';

/** Параметры запроса ленты. */
export interface FeedParams extends RequestOptions {
  /** Вкладка ленты. По умолчанию сервер отдаёт популярное. */
  tab?: FeedTab;
  /** Сколько постов на страницу. */
  limit?: number;
  /**
   * Курсор следующей страницы из предыдущего ответа.
   *
   * Передавайте значение как есть: его формат зависит от вкладки и может измениться.
   */
  cursor?: string;
  /** Ограничение числа страниц при переборе. */
  maxPages?: number;
}

/** Параметры запроса постов пользователя. */
export interface UserPostsParams extends RequestOptions {
  limit?: number;
  cursor?: string;
  /** Порядок сортировки. */
  sort?: string;
  /** Закреплённый пост, чтобы сервер поднял его наверх. */
  pinnedPostId?: string;
  maxPages?: number;
}

/** Параметры запроса комментариев к посту. */
export interface CommentsParams extends RequestOptions {
  limit?: number;
  /**
   * Курсор следующей страницы: идентификатор последнего полученного комментария.
   *
   * Передавайте значение из `nextCursor` предыдущего ответа как есть.
   */
  cursor?: string;
  sort?: CommentSort;
  maxPages?: number;
}

/**
 * Посты: лента, публикация, реакции, репосты, комментарии.
 *
 * Доступна как `itd.posts`.
 */
export class PostsResource extends BaseResource {
  readonly #uploadFiles: (files: FileInput[], options?: RequestOptions) => Promise<string[]>;

  constructor(
    http: HttpClient,
    deps: { uploadFiles: (files: FileInput[], options?: RequestOptions) => Promise<string[]> },
  ) {
    super(http);
    this.#uploadFiles = deps.uploadFiles;
  }

  /**
   * Загружает страницу ленты.
   *
   * @example
   * ```ts
   * const page = await itd.posts.list({ tab: FeedTab.Following, limit: 20 });
   * const next = await itd.posts.list({ tab: FeedTab.Following, cursor: page.nextCursor ?? undefined });
   * ```
   */
  async list(params: FeedParams = {}): Promise<Page<Post>> {
    const body = await this.http.request({
      method: 'GET',
      path: '/api/posts',
      query: { tab: params.tab, limit: params.limit, cursor: params.cursor },
      ...this.requestOptions(params),
    });

    return readCursorPage<Post>(body, 'posts');
  }

  /**
   * Перебирает ленту, сама подставляя курсоры.
   *
   * @example
   * ```ts
   * for await (const post of itd.posts.iterate({ tab: 'following' })) {
   *   console.log(post.author.username, post.content);
   * }
   * ```
   */
  iterate(params: FeedParams = {}): Paginator<Post> {
    return this.paginate<Post>(
      'cursor',
      async (state: PageState) => {
        const body = await this.http.request({
          method: 'GET',
          path: '/api/posts',
          query: withPageState({ tab: params.tab, limit: params.limit }, state),
          ...this.requestOptions(params),
        });
        return readCursorPage<Post>(body, 'posts');
      },
      params,
    );
  }

  /**
   * Публикует пост.
   *
   * Принимает обычный объект, {@link PostBuilder} или функцию-настройщик. Файлы из поля
   * `files` загружаются автоматически, порядок вложений сохраняется.
   *
   * @example
   * ```ts
   * await itd.posts.create({ content: 'привет' });
   * await itd.posts.create((p) => p.content('привет').attach('./photo.jpg'));
   * ```
   */
  async create(input: PostInput, options: RequestOptions = {}): Promise<Post> {
    const data = resolvePost(input);
    const attachmentIds = await this.#collectAttachments(data, options);

    return this.http.request<Post>({
      method: 'POST',
      path: '/api/posts',
      body: {
        content: data.content ?? '',
        ...(data.spans ? { spans: data.spans } : {}),
        ...(data.wallRecipientId ? { wallRecipientId: data.wallRecipientId } : {}),
        ...(attachmentIds.length > 0 ? { attachmentIds } : {}),
        ...(data.poll ? { poll: data.poll } : {}),
      },
      ...this.requestOptions(options),
    });
  }

  /**
   * Загружает один пост вместе с топовыми комментариями.
   *
   * В отличие от списков, здесь у поста заполнено поле `comments`.
   */
  get(postId: string, options: RequestOptions = {}): Promise<Post> {
    return this.http.request<Post>({
      method: 'GET',
      path: `/api/posts/${encodePathSegment(postId, 'postId')}`,
      ...this.requestOptions(options),
    });
  }

  /** Редактирует текст поста. */
  update(
    postId: string,
    input: Pick<CreatePostInput, 'content' | 'spans'>,
    options: RequestOptions = {},
  ): Promise<Post> {
    return this.http.request<Post>({
      method: 'PUT',
      path: `/api/posts/${encodePathSegment(postId, 'postId')}`,
      body: { content: input.content ?? '', ...(input.spans ? { spans: input.spans } : {}) },
      ...this.requestOptions(options),
    });
  }

  /** Удаляет пост. Восстановить его можно через {@link restore}. */
  remove(postId: string, options: RequestOptions = {}): Promise<void> {
    return this.http.request<void>({
      method: 'DELETE',
      path: `/api/posts/${encodePathSegment(postId, 'postId')}`,
      ...this.requestOptions(options),
    });
  }

  /** Восстанавливает удалённый пост. */
  restore(postId: string, options: RequestOptions = {}): Promise<Post> {
    return this.http.request<Post>({
      method: 'POST',
      path: `/api/posts/${encodePathSegment(postId, 'postId')}/restore`,
      ...this.requestOptions(options),
    });
  }

  /** Ставит реакцию на пост. */
  like(postId: string, options: RequestOptions = {}): Promise<LikeResult> {
    return this.http.request<LikeResult>({
      method: 'POST',
      path: `/api/posts/${encodePathSegment(postId, 'postId')}/like`,
      ...this.requestOptions(options),
    });
  }

  /** Убирает реакцию с поста. */
  unlike(postId: string, options: RequestOptions = {}): Promise<LikeResult> {
    return this.http.request<LikeResult>({
      method: 'DELETE',
      path: `/api/posts/${encodePathSegment(postId, 'postId')}/like`,
      ...this.requestOptions(options),
    });
  }

  /**
   * Делает репост с необязательным комментарием.
   *
   * Вложения к репосту не поддерживаются: сервер их игнорирует, поэтому параметров
   * для файлов здесь нет.
   */
  repost(postId: string, content = '', options: RequestOptions = {}): Promise<Post> {
    return this.http.request<Post>({
      method: 'POST',
      path: `/api/posts/${encodePathSegment(postId, 'postId')}/repost`,
      body: { content },
      ...this.requestOptions(options),
    });
  }

  /** Отменяет репост. */
  unrepost(postId: string, options: RequestOptions = {}): Promise<void> {
    return this.http.request<void>({
      method: 'DELETE',
      path: `/api/posts/${encodePathSegment(postId, 'postId')}/repost`,
      ...this.requestOptions(options),
    });
  }

  /** Закрепляет пост в профиле. */
  pin(postId: string, options: RequestOptions = {}): Promise<PinPostResult> {
    return this.http.request<PinPostResult>({
      method: 'POST',
      path: `/api/posts/${encodePathSegment(postId, 'postId')}/pin`,
      ...this.requestOptions(options),
    });
  }

  /** Открепляет пост. */
  unpin(postId: string, options: RequestOptions = {}): Promise<PinPostResult> {
    return this.http.request<PinPostResult>({
      method: 'DELETE',
      path: `/api/posts/${encodePathSegment(postId, 'postId')}/pin`,
      ...this.requestOptions(options),
    });
  }

  /**
   * Голосует в опросе.
   *
   * @param optionIds выбранные варианты; несколько допустимы только при `multipleChoice`
   */
  vote(postId: string, optionIds: string[], options: RequestOptions = {}): Promise<Poll> {
    return this.http.request<Poll>({
      method: 'POST',
      path: `/api/posts/${encodePathSegment(postId, 'postId')}/poll/vote`,
      body: { optionIds },
      ...this.requestOptions(options),
    });
  }

  /** Запрашивает счётчики сразу для нескольких постов. */
  async stats(ids: string[], options: RequestOptions = {}): Promise<PostStats[]> {
    const body = await this.http.request({
      method: 'POST',
      path: '/api/posts/stats',
      body: { ids },
      ...this.requestOptions(options),
    });

    return pickArray<PostStats>(body, 'posts');
  }

  /** Загружает страницу постов пользователя (его стену). */
  async byUser(user: UserRef, params: UserPostsParams = {}): Promise<Page<Post>> {
    const body = await this.http.request({
      method: 'GET',
      path: `/api/posts/user/${encodePathSegment(user, 'user')}`,
      query: {
        limit: params.limit,
        cursor: params.cursor,
        sort: params.sort,
        pinnedPostId: params.pinnedPostId,
      },
      ...this.requestOptions(params),
    });

    return readCursorPage<Post>(body, 'posts');
  }

  /** Перебирает посты пользователя. */
  iterateByUser(user: UserRef, params: UserPostsParams = {}): Paginator<Post> {
    const path = `/api/posts/user/${encodePathSegment(user, 'user')}`;

    return this.paginate<Post>(
      'cursor',
      async (state) => {
        const body = await this.http.request({
          method: 'GET',
          path,
          query: withPageState(
            { limit: params.limit, sort: params.sort, pinnedPostId: params.pinnedPostId },
            state,
          ),
          ...this.requestOptions(params),
        });
        return readCursorPage<Post>(body, 'posts');
      },
      params,
    );
  }

  /** Загружает страницу постов, которые пользователь отметил реакцией. */
  async likedByUser(user: UserRef, params: UserPostsParams = {}): Promise<Page<Post>> {
    const body = await this.http.request({
      method: 'GET',
      path: `/api/posts/user/${encodePathSegment(user, 'user')}/liked`,
      query: { limit: params.limit, cursor: params.cursor },
      ...this.requestOptions(params),
    });

    return readCursorPage<Post>(body, 'posts');
  }

  /** Перебирает посты, которые пользователь отметил реакцией. */
  iterateLikedByUser(user: UserRef, params: UserPostsParams = {}): Paginator<Post> {
    const path = `/api/posts/user/${encodePathSegment(user, 'user')}/liked`;

    return this.paginate<Post>(
      'cursor',
      async (state) => {
        const body = await this.http.request({
          method: 'GET',
          path,
          query: withPageState({ limit: params.limit }, state),
          ...this.requestOptions(params),
        });
        return readCursorPage<Post>(body, 'posts');
      },
      params,
    );
  }

  /**
   * Загружает страницу комментариев к посту.
   *
   * У этого эндпоинта курсор и признак продолжения лежат рядом со списком, а не внутри
   * объекта `pagination`, как у остальных, — разница скрыта внутри.
   */
  async comments(postId: string, params: CommentsParams = {}): Promise<Page<Comment>> {
    const body = await this.http.request({
      method: 'GET',
      path: `/api/posts/${encodePathSegment(postId, 'postId')}/comments`,
      query: { limit: params.limit, cursor: params.cursor, sort: params.sort },
      ...this.requestOptions(params),
    });

    return readFlatCursorPage<Comment>(body, 'comments');
  }

  /** Перебирает комментарии к посту. */
  iterateComments(postId: string, params: CommentsParams = {}): Paginator<Comment> {
    const path = `/api/posts/${encodePathSegment(postId, 'postId')}/comments`;

    return this.paginate<Comment>(
      'cursor',
      async (state) => {
        const body = await this.http.request({
          method: 'GET',
          path,
          query: withPageState({ limit: params.limit, sort: params.sort }, state),
          ...this.requestOptions(params),
        });
        return readFlatCursorPage<Comment>(body, 'comments');
      },
      params,
    );
  }

  /**
   * Комментирует пост.
   *
   * @example
   * ```ts
   * await itd.posts.comment(postId, 'согласен');
   * await itd.posts.comment(postId, (c) => c.content('смотри').attach('./meme.png'));
   * ```
   */
  async comment(
    postId: string,
    input: CommentInput | string,
    options: RequestOptions = {},
  ): Promise<Comment> {
    const data = resolveComment(typeof input === 'string' ? { content: input } : input);
    const attachmentIds = await this.#collectAttachments(data, options);

    return this.http.request<Comment>({
      method: 'POST',
      path: `/api/posts/${encodePathSegment(postId, 'postId')}/comments`,
      body: { content: data.content ?? '', attachmentIds },
      ...this.requestOptions(options),
    });
  }

  /**
   * Отправляет голосовой комментарий.
   *
   * Текста у такого комментария нет: сервер ждёт пустой `content` и одно аудиовложение
   * в формате `audio/ogg`.
   *
   * @example
   * ```ts
   * await itd.posts.voiceComment(postId, './answer.ogg');
   * ```
   */
  voiceComment(postId: string, audio: FileInput, options: RequestOptions = {}): Promise<Comment> {
    return this.comment(postId, { content: '', files: [audio] }, options);
  }

  /** Загружает файлы из входных данных и объединяет их с уже готовыми идентификаторами. */
  async #collectAttachments(
    data: CreatePostInput | CreateCommentInput,
    options: RequestOptions,
  ): Promise<string[]> {
    const existing = data.attachmentIds ?? [];
    const files = data.files ?? [];

    if (files.length === 0) return existing;

    const uploaded = await this.#uploadFiles(files, options);
    return [...existing, ...uploaded];
  }
}
