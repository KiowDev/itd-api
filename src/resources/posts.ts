import { type CommentInput, resolveComment } from '../builders/comment.js';
import {
  type PostInput,
  type PostUpdateInput,
  resolvePost,
  resolvePostUpdate,
} from '../builders/post.js';
import type { FileInput } from '../core/attachments/contracts.js';
import type { HttpClient } from '../core/execution/http.js';
import type { PaginationOptions, RequestOptions } from '../core/options.js';
import { pickArray } from '../core/unwrap.js';
import { encodePathSegment } from '../core/url.js';
import { defineBuiltInOperation } from '../domain/operations.js';
import type { CreateCommentInput, CreatePostData } from '../domain/params.js';
import type { UserRef } from '../models/common.js';
import type {
  Comment,
  LikeResult,
  PinPostResult,
  Poll,
  Post,
  PostStats,
  PostUpdateResult,
} from '../models/content.js';
import { passthroughOperation, voidOperation } from '../operations/common.js';
import type { CommentSort, FeedTab } from '../types/enums.js';
import { BaseResource } from './base.js';
import {
  type Page,
  PaginationMode,
  type Paginator,
  pageOperation,
  readCursorPage,
  readFlatCursorPage,
} from './pagination.js';

const POSTS_LIST = pageOperation<Post>('posts.list', (body) => readCursorPage<Post>(body, 'posts'));
const POSTS_BY_USER = pageOperation<Post>('posts.byUser', (body) =>
  readCursorPage<Post>(body, 'posts'),
);
const POSTS_LIKED_BY_USER = pageOperation<Post>('posts.likedByUser', (body) =>
  readCursorPage<Post>(body, 'posts'),
);
const POSTS_COMMENTS = pageOperation<Comment>('posts.comments', (body) =>
  readFlatCursorPage<Comment>(body, 'comments'),
);
const POSTS_STATS = defineBuiltInOperation<PostStats[]>('posts.stats', (body) =>
  pickArray<PostStats>(body, 'posts'),
);
const POSTS_CREATE = passthroughOperation<Post>('posts.create');
const POSTS_GET = passthroughOperation<Post>('posts.get');
const POSTS_UPDATE = passthroughOperation<PostUpdateResult>('posts.update');
const POSTS_RESTORE = voidOperation('posts.restore');
const POSTS_LIKE = passthroughOperation<LikeResult>('posts.like');
const POSTS_UNLIKE = passthroughOperation<LikeResult>('posts.unlike');
const POSTS_REPOST = passthroughOperation<Post>('posts.repost');
const POSTS_PIN = passthroughOperation<PinPostResult>('posts.pin');
const POSTS_UNPIN = passthroughOperation<PinPostResult>('posts.unpin');
const POSTS_VOTE = passthroughOperation<Poll>('posts.vote');
const POSTS_COMMENT = passthroughOperation<Comment>('posts.comment');
const POSTS_REMOVE = voidOperation('posts.remove');
const POSTS_UNREPOST = voidOperation('posts.unrepost');

/** Курсорная позиция из параметров: если курсор задан — с него, иначе с начала. */
function cursorStart(params: { cursor?: string | undefined }): { cursor?: string } {
  return params.cursor ? { cursor: params.cursor } : {};
}

/** Параметры запроса ленты. */
export interface FeedParams {
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
}

/** Параметры запроса постов пользователя. */
export interface UserPostsParams {
  limit?: number;
  cursor?: string;
  /** Порядок сортировки. */
  sort?: string;
  /** Закреплённый пост, чтобы сервер поднял его наверх. */
  pinnedPostId?: string;
}

/** Параметры запроса комментариев к посту. */
export interface CommentsParams {
  limit?: number;
  /**
   * Курсор следующей страницы: идентификатор последнего полученного комментария.
   *
   * Передавайте значение из `nextCursor` предыдущего ответа как есть.
   */
  cursor?: string;
  sort?: CommentSort;
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
    operation: POSTS_LIST,
    path: () => '/api/posts',
    query: (p) => ({ tab: p.tab, limit: p.limit }),
    start: cursorStart,
    mode: PaginationMode.Cursor,
  });

  /** Стена пользователя: `/api/posts/user/{user}`. */
  readonly #wall = this.paginated<Post, UserPostsParams & { user: UserRef }>({
    operation: POSTS_BY_USER,
    path: (p) => `/api/posts/user/${encodePathSegment(p.user, 'user')}`,
    query: (p) => ({ limit: p.limit, sort: p.sort, pinnedPostId: p.pinnedPostId }),
    start: cursorStart,
    mode: PaginationMode.Cursor,
  });

  /** Понравившиеся посты пользователя: `/api/posts/user/{user}/liked`. */
  readonly #liked = this.paginated<Post, UserPostsParams & { user: UserRef }>({
    operation: POSTS_LIKED_BY_USER,
    path: (p) => `/api/posts/user/${encodePathSegment(p.user, 'user')}/liked`,
    query: (p) => ({ limit: p.limit }),
    start: cursorStart,
    mode: PaginationMode.Cursor,
  });

  /** Комментарии к посту: курсор лежит рядом со списком, поэтому свой reader. */
  readonly #comments = this.paginated<Comment, CommentsParams & { postId: string }>({
    operation: POSTS_COMMENTS,
    path: (p) => `/api/posts/${encodePathSegment(p.postId, 'postId')}/comments`,
    query: (p) => ({ limit: p.limit, sort: p.sort }),
    start: cursorStart,
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
  list(params: FeedParams = {}, options: RequestOptions = {}): Promise<Page<Post>> {
    return this.#feed.list(params, options);
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
  iterate(params: FeedParams = {}, options: PaginationOptions = {}): Paginator<Post> {
    return this.#feed.iterate(params, options);
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
   * await itd.posts.create((p) => p.content('привет').attach({ url: 'https://example.com/photo.jpg' }));
   * ```
   */
  async create(input: PostInput, options: RequestOptions = {}): Promise<Post> {
    const data = resolvePost(input);
    const attachmentIds = await this.#collectAttachments(data, options);

    return this.http.execute(POSTS_CREATE, {
      path: '/api/posts',
      body: {
        content: data.content ?? '',
        ...(data.spans ? { spans: data.spans } : {}),
        ...(data.wallRecipientId ? { wallRecipientId: data.wallRecipientId } : {}),
        ...(attachmentIds.length > 0 ? { attachmentIds } : {}),
        ...(data.poll ? { poll: data.poll } : {}),
      },
      ...options,
    });
  }

  /**
   * Загружает один пост вместе с топовыми комментариями.
   *
   * В отличие от списков, здесь у поста заполнено поле `comments`.
   */
  get(postId: string, options: RequestOptions = {}): Promise<Post> {
    return this.http.execute(POSTS_GET, {
      path: `/api/posts/${encodePathSegment(postId, 'postId')}`,
      ...options,
    });
  }

  /**
   * Редактирует текст и разметку поста.
   *
   * Как и {@link create}, принимает объект, готовый {@link PostBuilder} или
   * функцию-настройщик. Поля создания поста, которые update endpoint не поддерживает
   * (вложения, опрос и стена), отвергаются до запроса.
   */
  update(
    postId: string,
    input: PostUpdateInput,
    options: RequestOptions = {},
  ): Promise<PostUpdateResult> {
    const data = resolvePostUpdate(input);
    return this.http.execute(POSTS_UPDATE, {
      path: `/api/posts/${encodePathSegment(postId, 'postId')}`,
      body: { content: data.content, ...(data.spans ? { spans: data.spans } : {}) },
      ...options,
    });
  }

  /** Удаляет пост. Восстановить его можно через {@link restore}. */
  remove(postId: string, options: RequestOptions = {}): Promise<void> {
    return this.voidOperation(POSTS_REMOVE, {
      path: `/api/posts/${encodePathSegment(postId, 'postId')}`,
      ...options,
    });
  }

  /** Восстанавливает удалённый пост. */
  restore(postId: string, options: RequestOptions = {}): Promise<void> {
    return this.voidOperation(POSTS_RESTORE, {
      path: `/api/posts/${encodePathSegment(postId, 'postId')}/restore`,
      ...options,
    });
  }

  /** Ставит реакцию на пост. */
  like(postId: string, options: RequestOptions = {}): Promise<LikeResult> {
    return this.http.execute(POSTS_LIKE, {
      path: `/api/posts/${encodePathSegment(postId, 'postId')}/like`,
      ...options,
    });
  }

  /** Убирает реакцию с поста. */
  unlike(postId: string, options: RequestOptions = {}): Promise<LikeResult> {
    return this.http.execute(POSTS_UNLIKE, {
      path: `/api/posts/${encodePathSegment(postId, 'postId')}/like`,
      ...options,
    });
  }

  /**
   * Делает репост с необязательным комментарием.
   *
   * Вложения к репосту не поддерживаются: сервер их игнорирует, поэтому параметров
   * для файлов здесь нет.
   */
  repost(postId: string, content = '', options: RequestOptions = {}): Promise<Post> {
    return this.http.execute(POSTS_REPOST, {
      path: `/api/posts/${encodePathSegment(postId, 'postId')}/repost`,
      body: { content },
      ...options,
    });
  }

  /** Отменяет репост. */
  unrepost(postId: string, options: RequestOptions = {}): Promise<void> {
    return this.voidOperation(POSTS_UNREPOST, {
      path: `/api/posts/${encodePathSegment(postId, 'postId')}/repost`,
      ...options,
    });
  }

  /** Закрепляет пост в профиле. */
  pin(postId: string, options: RequestOptions = {}): Promise<PinPostResult> {
    return this.http.execute(POSTS_PIN, {
      path: `/api/posts/${encodePathSegment(postId, 'postId')}/pin`,
      ...options,
    });
  }

  /** Открепляет пост. */
  unpin(postId: string, options: RequestOptions = {}): Promise<PinPostResult> {
    return this.http.execute(POSTS_UNPIN, {
      path: `/api/posts/${encodePathSegment(postId, 'postId')}/pin`,
      ...options,
    });
  }

  /**
   * Голосует в опросе.
   *
   * @param optionIds выбранные варианты; несколько допустимы только при `multipleChoice`
   */
  vote(postId: string, optionIds: string[], options: RequestOptions = {}): Promise<Poll> {
    return this.http.execute(POSTS_VOTE, {
      path: `/api/posts/${encodePathSegment(postId, 'postId')}/poll/vote`,
      body: { optionIds },
      ...options,
    });
  }

  /** Запрашивает счётчики сразу для нескольких постов. */
  stats(ids: string[], options: RequestOptions = {}): Promise<PostStats[]> {
    return this.http.execute(POSTS_STATS, {
      path: '/api/posts/stats',
      body: { ids },
      ...options,
    });
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
  byUser(
    user: UserRef,
    params: UserPostsParams = {},
    options: RequestOptions = {},
  ): Promise<Page<Post>> {
    return this.#wall.list({ ...params, user }, options);
  }

  /** Перебирает стену пользователя. Что именно в неё входит — см. {@link byUser}. */
  iterateByUser(
    user: UserRef,
    params: UserPostsParams = {},
    options: PaginationOptions = {},
  ): Paginator<Post> {
    return this.#wall.iterate({ ...params, user }, options);
  }

  /** Загружает страницу постов, которые пользователь отметил реакцией. */
  likedByUser(
    user: UserRef,
    params: UserPostsParams = {},
    options: RequestOptions = {},
  ): Promise<Page<Post>> {
    return this.#liked.list({ ...params, user }, options);
  }

  /** Перебирает посты, которые пользователь отметил реакцией. */
  iterateLikedByUser(
    user: UserRef,
    params: UserPostsParams = {},
    options: PaginationOptions = {},
  ): Paginator<Post> {
    return this.#liked.iterate({ ...params, user }, options);
  }

  /**
   * Загружает страницу комментариев к посту.
   *
   * У этого эндпоинта курсор и признак продолжения лежат рядом со списком, а не внутри
   * объекта `pagination`, как у остальных, — разница скрыта внутри.
   */
  comments(
    postId: string,
    params: CommentsParams = {},
    options: RequestOptions = {},
  ): Promise<Page<Comment>> {
    return this.#comments.list({ ...params, postId }, options);
  }

  /** Перебирает комментарии к посту. */
  iterateComments(
    postId: string,
    params: CommentsParams = {},
    options: PaginationOptions = {},
  ): Paginator<Comment> {
    return this.#comments.iterate({ ...params, postId }, options);
  }

  /**
   * Комментирует пост.
   *
   * @example
   * ```ts
   * await itd.posts.comment(postId, 'согласен');
   * await itd.posts.comment(postId, (c) => c.content('смотри').attach(blob));
   * ```
   */
  async comment(
    postId: string,
    input: CommentInput | string,
    options: RequestOptions = {},
  ): Promise<Comment> {
    const data = resolveComment(typeof input === 'string' ? { content: input } : input);
    const attachmentIds = await this.#collectAttachments(data, options);

    return this.http.execute(POSTS_COMMENT, {
      path: `/api/posts/${encodePathSegment(postId, 'postId')}/comments`,
      body: { content: data.content ?? '', attachmentIds },
      ...options,
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
   * import { fromPath } from 'itd-api/node';
   *
   * await itd.posts.voiceComment(postId, fromPath('./answer.ogg'));
   * ```
   */
  voiceComment(postId: string, audio: FileInput, options: RequestOptions = {}): Promise<Comment> {
    return this.comment(postId, { content: '', files: [audio] }, options);
  }

  /** Загружает файлы из входных данных и объединяет их с уже готовыми идентификаторами. */
  async #collectAttachments(
    data: CreatePostData | CreateCommentInput,
    options: RequestOptions,
  ): Promise<string[]> {
    const existing = data.attachmentIds ?? [];
    const files = data.files ?? [];

    if (files.length === 0) return existing;

    const uploaded = await this.#uploadFiles(files, options);
    return [...existing, ...uploaded];
  }
}
