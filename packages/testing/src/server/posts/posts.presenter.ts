import type { Post } from 'itd-api';
import { postFixture } from '../../fixtures/models.fixtures.js';
import type { CommentService } from '../comments/comments.service.js';
import type { UserPresenter } from '../users/users.presenter.js';
import type { UserService } from '../users/users.service.js';
import type { UserRecord } from '../users/users.types.js';
import type { PostRecord } from './posts.types.js';

/** Посты в форме ответов API относительно текущего пользователя. @internal */
export class PostPresenter {
  readonly #users: UserService;
  readonly #comments: CommentService;
  readonly #userPresenter: UserPresenter;

  constructor(users: UserService, comments: CommentService, userPresenter: UserPresenter) {
    this.#users = users;
    this.#comments = comments;
    this.#userPresenter = userPresenter;
  }

  post(post: PostRecord, viewer: UserRecord): Post {
    const author = this.#users.get(post.authorId);
    if (!author) throw new Error(`У поста ${post.id} нет автора ${post.authorId}`);
    return postFixture({
      id: post.id,
      content: post.content,
      spans: structuredClone(post.spans),
      author: this.#userPresenter.reference(author),
      wallRecipientId: post.wallRecipientId,
      likesCount: post.likedBy.size,
      commentsCount: this.#comments.activeCountFor(post),
      isLiked: post.likedBy.has(viewer.profile.id),
      isOwner: post.authorId === viewer.profile.id,
      editedAt: post.editedAt,
      createdAt: post.createdAt,
    });
  }
}
