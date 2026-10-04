import { NotificationType } from 'itd-api';
import type { NotificationService } from '../notifications/notifications.service.js';
import { canAccess } from '../shared/access.utils.js';
import { MockDomainError } from '../shared/domain.errors.js';
import type { MockStore } from '../store/mock.store.js';
import type { UserService } from '../users/users.service.js';
import type { UserRecord } from '../users/users.types.js';
import { clanOf } from '../users/users.utils.js';
import type { NewPost, PostEdit, PostRecord } from './posts.types.js';

function newestFirst(a: PostRecord, b: PostRecord): number {
  return b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id);
}

/** Посты, их публикация, удаление и реакции. @internal */
export class PostService {
  readonly #store: MockStore;
  readonly #users: UserService;
  readonly #notifications: NotificationService;

  constructor(store: MockStore, users: UserService, notifications: NotificationService) {
    this.#store = store;
    this.#users = users;
    this.#notifications = notifications;
  }

  /** Все активные посты, сначала новые. */
  feed(): PostRecord[] {
    return this.#active(() => true);
  }

  /** Активные посты авторов, на которых подписан пользователь. */
  followingFeed(viewer: UserRecord): PostRecord[] {
    return this.#active((post) => viewer.following.has(post.authorId));
  }

  /** Активные посты авторов из клана пользователя (`clanAvatar`), включая его собственные. */
  clanFeed(viewer: UserRecord): PostRecord[] {
    const clan = clanOf(viewer);
    return this.#active((post) => {
      const author = this.#store.users.get(post.authorId);
      return author !== undefined && clanOf(author) === clan;
    });
  }

  /**
   * Активные посты, которые лайкнул владелец списка. Если `likesVisibility` закрывает список
   * от обращающегося, список пуст: прод в этом случае не отвечает ошибкой.
   */
  likedBy(owner: UserRecord, viewer: UserRecord): PostRecord[] {
    const visible = canAccess(owner.profile.likesVisibility, this.#users.relation(owner, viewer));
    return visible ? this.#active((post) => post.likedBy.has(owner.profile.id)) : [];
  }

  /** Активные посты на стене пользователя: свои без адресата и адресованные ему. */
  wall(owner: UserRecord): PostRecord[] {
    return this.#active((post) => (post.wallRecipientId ?? post.authorId) === owner.profile.id);
  }

  activeCountBy(author: UserRecord): number {
    let count = 0;
    for (const post of this.#store.posts.values()) {
      if (!post.deleted && post.authorId === author.profile.id) count += 1;
    }
    return count;
  }

  /** Видимый пост: не удалён, автор не деактивирован. */
  requireActive(postId: string): PostRecord {
    const post = this.#store.posts.get(postId);
    if (!post || !this.#visible(post)) throw MockDomainError.notFound('Post not found');
    return post;
  }

  /** Пост автора, в том числе удалённый: автор может его восстановить. */
  requireOwn(postId: string, author: UserRecord): PostRecord {
    const post = this.#store.posts.get(postId);
    if (!post) throw MockDomainError.notFound('Post not found');
    if (post.authorId !== author.profile.id) {
      throw MockDomainError.forbidden('Пост принадлежит другому пользователю');
    }
    return post;
  }

  /**
   * Публикует пост. Пост на своей стене хранится без адресата; на чужую стену можно писать,
   * только если её `wallAccess` разрешает это автору.
   */
  create(author: UserRecord, input: NewPost): PostRecord {
    const wallRecipientId = this.#wallRecipient(author, input.wallRecipientId);
    const post: PostRecord = {
      id: this.#store.nextPostId(),
      authorId: author.profile.id,
      content: input.content,
      spans: input.spans,
      originalPostId: null,
      wallRecipientId,
      createdAt: this.#store.now(),
      editedAt: null,
      likedBy: new Set(),
      deleted: false,
    };
    this.#store.posts.set(post.id, post);
    if (post.wallRecipientId) {
      this.#notifications.notify({
        recipientId: post.wallRecipientId,
        type: NotificationType.WallPost,
        actorId: author.profile.id,
        entityId: post.id,
        preview: post.content,
      });
    }
    return post;
  }

  edit(post: PostRecord, changes: PostEdit): void {
    if (changes.content !== undefined) {
      post.content = changes.content;
      post.spans = changes.spans ?? [];
    } else if (changes.spans !== undefined) {
      post.spans = changes.spans;
    }
    post.editedAt = this.#store.now();
  }

  remove(post: PostRecord): void {
    post.deleted = true;
  }

  restore(post: PostRecord): void {
    post.deleted = false;
  }

  /**
   * Репостит пост с необязательным текстом. Каждый вызов создаёт новый репост, но автор поста
   * получает уведомление только о первом активном репосте пользователя. Репост репоста
   * ссылается на сам репост, поэтому цепочка может быть любой длины.
   */
  repost(user: UserRecord, postId: string, content: string): PostRecord {
    const parent = this.requireActive(postId);
    const firstRepost = !this.hasReposted(user, parent.id);
    const repost: PostRecord = {
      id: this.#store.nextPostId(),
      authorId: user.profile.id,
      content,
      spans: [],
      originalPostId: parent.id,
      wallRecipientId: null,
      createdAt: this.#store.now(),
      editedAt: null,
      likedBy: new Set(),
      deleted: false,
    };
    this.#store.posts.set(repost.id, repost);
    if (firstRepost) {
      this.#notifications.notify({
        recipientId: parent.authorId,
        type: NotificationType.PostRepost,
        actorId: user.profile.id,
        entityId: repost.id,
        preview: parent.content,
      });
    }
    return repost;
  }

  /**
   * Удаляет все репосты поста от пользователя и возвращает, сколько пользователей его ещё
   * репостят. Сам пост и чужие репосты не меняются; удалённый исходный пост отмене не мешает.
   */
  unrepost(user: UserRecord, postId: string): number {
    const reposts = this.#repostsBy(user, postId);
    if (reposts.length === 0) throw MockDomainError.notFound('Repost not found');
    for (const repost of reposts) repost.deleted = true;
    return this.#countReposters(postId);
  }

  /** Есть ли у пользователя активный репост поста. */
  hasReposted(user: UserRecord, postId: string): boolean {
    return this.#repostsBy(user, postId).length > 0;
  }

  /** Сколько пользователей репостят пост: несколько репостов одного пользователя считаются одним. */
  repostsCount(post: PostRecord): number {
    return this.#countReposters(post.id);
  }

  /** Пост, который репостнули, если он виден. */
  activeParent(post: PostRecord): PostRecord | undefined {
    if (!post.originalPostId) return undefined;
    const parent = this.#store.posts.get(post.originalPostId);
    return parent && this.#visible(parent) ? parent : undefined;
  }

  /** Возвращает `true`, если реакция появилась. Только новая реакция уведомляет автора. */
  like(user: UserRecord, post: PostRecord): boolean {
    if (post.likedBy.has(user.profile.id)) return false;
    post.likedBy.add(user.profile.id);
    this.#notifications.notify({
      recipientId: post.authorId,
      type: NotificationType.PostReaction,
      actorId: user.profile.id,
      entityId: post.id,
      preview: post.content,
    });
    return true;
  }

  /** Возвращает `true`, если реакция была. */
  unlike(user: UserRecord, post: PostRecord): boolean {
    return post.likedBy.delete(user.profile.id);
  }

  #active(predicate: (post: PostRecord) => boolean): PostRecord[] {
    return [...this.#store.posts.values()]
      .filter((post) => this.#visible(post) && predicate(post))
      .sort(newestFirst);
  }

  #repostsBy(user: UserRecord, postId: string): PostRecord[] {
    return [...this.#store.posts.values()].filter(
      (post) =>
        !post.deleted && post.originalPostId === postId && post.authorId === user.profile.id,
    );
  }

  #countReposters(postId: string): number {
    const reposters = new Set<string>();
    for (const candidate of this.#store.posts.values()) {
      if (candidate.originalPostId === postId && this.#visible(candidate)) {
        reposters.add(candidate.authorId);
      }
    }
    return reposters.size;
  }

  #visible(post: PostRecord): boolean {
    return !post.deleted && this.#users.isActive(post.authorId);
  }

  #wallRecipient(author: UserRecord, recipientId: string | null): string | null {
    if (!recipientId || recipientId === author.profile.id) return null;
    const recipient = this.#users.require(recipientId);
    if (recipient === author) return null;
    if (!canAccess(recipient.profile.wallAccess, this.#users.relation(recipient, author))) {
      throw new MockDomainError(403, 'WRITE_ACCESS_RESTRICTED', 'Стена закрыта для записей');
    }
    return recipient.profile.id;
  }
}
