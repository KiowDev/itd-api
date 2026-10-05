import type { LikeResult, OriginalPost, Post, PostUpdateResult } from 'itd-api';
import { postFixture } from '../../fixtures/models.fixtures.js';
import type { CommentService } from '../comments/comments.service.js';
import type { CursorSlice } from '../shared/pagination.types.js';
import { cursorPagination } from '../shared/pagination.utils.js';
import type { UserPresenter } from '../users/users.presenter.js';
import type { UserService } from '../users/users.service.js';
import type { UserRecord } from '../users/users.types.js';
import type { PostService } from './posts.service.js';
import type { PostPage, PostRecord } from './posts.types.js';
import { postgresStamp } from './posts.utils.js';

/** Посты в форме ответов API относительно текущего пользователя. @internal */
export class PostPresenter {
  readonly #users: UserService;
  readonly #posts: PostService;
  readonly #comments: CommentService;
  readonly #userPresenter: UserPresenter;

  constructor(
    users: UserService,
    posts: PostService,
    comments: CommentService,
    userPresenter: UserPresenter,
  ) {
    this.#users = users;
    this.#posts = posts;
    this.#comments = comments;
    this.#userPresenter = userPresenter;
  }

  post(post: PostRecord, viewer: UserRecord): Post {
    const parent = this.#posts.activeParent(post);
    return postFixture({
      id: post.id,
      content: post.content,
      spans: structuredClone(post.spans),
      author: this.#author(post),
      wallRecipientId: post.wallRecipientId,
      likesCount: post.likedBy.size,
      commentsCount: this.#comments.activeCountFor(post),
      repostsCount: this.#posts.repostsCount(post),
      isLiked: post.likedBy.has(viewer.profile.id),
      isReposted: this.#posts.hasReposted(viewer, post.id),
      isOwner: post.authorId === viewer.profile.id,
      originalPost: parent ? this.originalPost(parent) : null,
      editedAt: post.editedAt,
      createdAt: post.createdAt,
    });
  }

  /** Курсорная страница постов в форме ответа API: `{ posts, pagination }`. */
  page(slice: CursorSlice<PostRecord>, viewer: UserRecord): PostPage {
    return {
      posts: slice.items.map((post) => this.post(post, viewer)),
      pagination: cursorPagination(slice),
    };
  }

  updateResult(post: PostRecord): PostUpdateResult {
    return {
      id: post.id,
      content: post.content,
      spans: structuredClone(post.spans),
      updatedAt: post.editedAt ?? post.createdAt,
    };
  }

  likeResult(post: PostRecord, liked: boolean): LikeResult {
    return { liked, likesCount: post.likedBy.size };
  }

  /**
   * Пост, который репостнули: один уровень, без признаков относительно текущего пользователя.
   * Дата — в формате PostgreSQL, как на проде. Удалённый родитель вместо объекта отдаётся `null`,
   * поэтому `isDeleted` здесь всегда `false`.
   */
  originalPost(post: PostRecord): OriginalPost {
    return {
      id: post.id,
      content: post.content,
      spans: structuredClone(post.spans),
      author: this.#author(post),
      attachments: [],
      likesCount: post.likedBy.size,
      commentsCount: this.#comments.activeCountFor(post),
      repostsCount: this.#posts.repostsCount(post),
      viewsCount: 0,
      isDeleted: false,
      createdAt: postgresStamp(post.createdAt),
    };
  }

  #author(post: PostRecord): Post['author'] {
    const author = this.#users.get(post.authorId);
    if (!author) throw new Error(`У поста ${post.id} нет автора ${post.authorId}`);
    return this.#userPresenter.author(author);
  }
}
