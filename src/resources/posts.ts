import { type CommentInput, resolveComment } from '../builders/comment.js';
import { type PostInput, resolvePost } from '../builders/post.js';
import type { HttpClient } from '../core/http.js';
import {
  type Page,
  PaginationMode,
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
import { BaseResource } from './base.js';

/** Курсорная позиция из параметров: если курсор задан — с него, иначе с начала. */
function cursorStart(params: { cursor?: string | undefined }): { cursor?: string } {
  return params.cursor ? { cursor: params.cursor } : {};
}

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

  /** Лента: `/api/posts`, курсорная пагинация. */
  readonly #feed = this.paginated<Post, FeedParams>({
    path: () => '/api/posts',
    query: (p) => ({ tab: p.tab, limit: p.limit }),
    start: cursorStart,
    read: (body) => readCursorPage<Post>(body, 'posts'),
    mode: PaginationMode.Cursor,
  });

  /** Стена пользователя: `/api/posts/user/{user}`. */
  readonly #wall = this.paginated<Post, UserPostsParams & { user: UserRef }>({
    path: (p) => `/api/posts/user/${encodePathSegment(p.user, 'user')}`,
    query: (p) => ({ limit: p.limit, sort: p.sort, pinnedPostId: p.pinnedPostId }),
    start: cursorStart,
    read: (body) => readCursorPage<Post>(body, 'posts'),
    mode: PaginationMode.Cursor,
  });

  /** Понравившиеся посты пользователя: `/api/posts/user/{user}/liked`. */
  readonly #liked = this.paginated<Post, UserPostsParams & { user: UserRef }>({
    path: (p) => `/api/posts/user/${encodePathSegment(p.user, 'user')}/liked`,
    query: (p) => ({ limit: p.limit }),
    start: cursorStart,
    read: (body) => readCursorPage<Post>(body, 'posts'),
    mode: PaginationMode.Cursor,
  });

  /** Комментарии к посту: курсор лежит рядом со списком, поэтому свой reader. */
  readonly #comments = this.paginated<Comment, CommentsParams & { postId: string }>({
    path: (p) => `/api/posts/${encodePathSegment(p.postId, 'postId')}/comments`,
    query: (p) => ({ limit: p.limit, sort: p.sort }),
    start: cursorStart,
    read: (body) => readFlatCursorPage<Comment>(body, 'comments'),
    mode: PaginationMode.Cursor,
  });

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
  list(params: FeedParams = {}): Promise<Page<Post>> {
    return this.#feed.list(params);
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
    return this.#feed.iterate(params);
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

  /**
   * Загружает страницу стены пользователя.
   *
   * Это **не только его собственные посты**: сюда попадают и записи, которые другие
   * оставили на его стене — у них `author` чужой, а `wallRecipient` указывает на владельца
   * стены. Поэтому число записей обычно больше, чем `postsCount` из профиля; чтобы
   * получить только авторские посты, отфильтруйте по `post.author.id`.
   *
   * Принимает и UUID, и имя пользователя.
   */
  byUser(user: UserRef, params: UserPostsParams = {}): Promise<Page<Post>> {
    return this.#wall.list({ ...params, user });
  }

  /** Перебирает стену пользователя. Что именно в неё входит — см. {@link byUser}. */
  iterateByUser(user: UserRef, params: UserPostsParams = {}): Paginator<Post> {
    return this.#wall.iterate({ ...params, user });
  }

  /** Загружает страницу постов, которые пользователь отметил реакцией. */
  likedByUser(user: UserRef, params: UserPostsParams = {}): Promise<Page<Post>> {
    return this.#liked.list({ ...params, user });
  }

  /** Перебирает посты, которые пользователь отметил реакцией. */
  iterateLikedByUser(user: UserRef, params: UserPostsParams = {}): Paginator<Post> {
    return this.#liked.iterate({ ...params, user });
  }

  /**
   * Загружает страницу комментариев к посту.
   *
   * У этого эндпоинта курсор и признак продолжения лежат рядом со списком, а не внутри
   * объекта `pagination`, как у остальных, — разница скрыта внутри.
   */
  comments(postId: string, params: CommentsParams = {}): Promise<Page<Comment>> {
    return this.#comments.list({ ...params, postId });
  }

  /** Перебирает комментарии к посту. */
  iterateComments(postId: string, params: CommentsParams = {}): Paginator<Comment> {
    return this.#comments.iterate({ ...params, postId });
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
