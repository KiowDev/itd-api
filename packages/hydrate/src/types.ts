import type {
  Actor,
  Attachment,
  Author,
  Comment,
  CommentReplyTo,
  CommentsResource,
  ItdClient,
  MyProfile,
  Page,
  Paginator,
  Post,
  PostsResource,
  Profile,
  PublicProfile,
  UserSummary,
  UsersResource,
} from 'itd-api';

type TailParameters<Method> = Method extends (first: infer _First, ...rest: infer Rest) => unknown
  ? Rest
  : never;

type HydratedMethodResult<Method> = Method extends (...args: never[]) => infer Result
  ? HydrateValue<Result>
  : never;

type ClientResourceName = {
  [Key in keyof ItdClient]: ItdClient[Key] extends (...args: never[]) => unknown
    ? never
    : ItdClient[Key] extends object
      ? Key
      : never;
}[keyof ItdClient] &
  string;

function defineHydratableResources<const Resources extends Record<string, ClientResourceName>>(
  resources: Resources &
    ([ClientResourceName] extends [Resources[keyof Resources]]
      ? unknown
      : { readonly __missingResource: Exclude<ClientResourceName, Resources[keyof Resources]> }),
): Readonly<Resources> {
  return Object.freeze(resources);
}

/** Ресурсы клиента, результаты которых проходят гидратацию. */
export const HydratableResource = defineHydratableResources({
  Auth: 'auth',
  Users: 'users',
  Posts: 'posts',
  Comments: 'comments',
  Files: 'files',
  Notifications: 'notifications',
  Hashtags: 'hashtags',
  Search: 'search',
  Reports: 'reports',
  Verification: 'verification',
  Subscription: 'subscription',
  Platform: 'platform',
  Telemetry: 'telemetry',
});

/** Имя ресурса, результаты которого проходят гидратацию. */
export type HydratableResource = (typeof HydratableResource)[keyof typeof HydratableResource];

/** Действия над постом. Идентификатор поста подставляется автоматически. */
export interface HydratedPostActions {
  /** Загружает свежее состояние поста. */
  get(...args: TailParameters<PostsResource['get']>): HydratedMethodResult<PostsResource['get']>;
  /** Ставит реакцию. */
  like(...args: TailParameters<PostsResource['like']>): HydratedMethodResult<PostsResource['like']>;
  /** Убирает реакцию. */
  unlike(
    ...args: TailParameters<PostsResource['unlike']>
  ): HydratedMethodResult<PostsResource['unlike']>;
  /** Добавляет комментарий. */
  comment(
    ...args: TailParameters<PostsResource['comment']>
  ): HydratedMethodResult<PostsResource['comment']>;
  /** Делает репост. */
  repost(
    ...args: TailParameters<PostsResource['repost']>
  ): HydratedMethodResult<PostsResource['repost']>;
  /** Удаляет пост. */
  remove(
    ...args: TailParameters<PostsResource['remove']>
  ): HydratedMethodResult<PostsResource['remove']>;
  /** Восстанавливает удалённый пост. */
  restore(
    ...args: TailParameters<PostsResource['restore']>
  ): HydratedMethodResult<PostsResource['restore']>;
  /** Закрепляет пост. */
  pin(...args: TailParameters<PostsResource['pin']>): HydratedMethodResult<PostsResource['pin']>;
  /** Открепляет пост. */
  unpin(
    ...args: TailParameters<PostsResource['unpin']>
  ): HydratedMethodResult<PostsResource['unpin']>;
}

/** Действия над комментарием. Идентификатор комментария подставляется автоматически. */
export interface HydratedCommentActions {
  /** Ставит реакцию. */
  like(
    ...args: TailParameters<CommentsResource['like']>
  ): HydratedMethodResult<CommentsResource['like']>;
  /** Убирает реакцию. */
  unlike(
    ...args: TailParameters<CommentsResource['unlike']>
  ): HydratedMethodResult<CommentsResource['unlike']>;
  /** Отвечает на комментарий. */
  reply(
    ...args: TailParameters<CommentsResource['reply']>
  ): HydratedMethodResult<CommentsResource['reply']>;
  /** Изменяет текст комментария. */
  update(
    ...args: TailParameters<CommentsResource['update']>
  ): HydratedMethodResult<CommentsResource['update']>;
  /** Удаляет комментарий. */
  remove(
    ...args: TailParameters<CommentsResource['remove']>
  ): HydratedMethodResult<CommentsResource['remove']>;
  /** Восстанавливает удалённый комментарий. */
  restore(
    ...args: TailParameters<CommentsResource['restore']>
  ): HydratedMethodResult<CommentsResource['restore']>;
  /** Загружает страницу ответов. */
  getReplies(
    ...args: TailParameters<CommentsResource['replies']>
  ): HydratedMethodResult<CommentsResource['replies']>;
}

/** Действия над пользователем. Идентификатор пользователя подставляется автоматически. */
export interface HydratedUserActions {
  /** Загружает полный профиль. */
  get(...args: TailParameters<UsersResource['get']>): HydratedMethodResult<UsersResource['get']>;
  /** Подписывается на пользователя. */
  follow(
    ...args: TailParameters<UsersResource['follow']>
  ): HydratedMethodResult<UsersResource['follow']>;
  /** Отписывается от пользователя. */
  unfollow(
    ...args: TailParameters<UsersResource['unfollow']>
  ): HydratedMethodResult<UsersResource['unfollow']>;
  /** Блокирует пользователя. */
  block(
    ...args: TailParameters<UsersResource['block']>
  ): HydratedMethodResult<UsersResource['block']>;
  /** Снимает блокировку. */
  unblock(
    ...args: TailParameters<UsersResource['unblock']>
  ): HydratedMethodResult<UsersResource['unblock']>;
  /** Загружает страницу стены пользователя. */
  posts(
    ...args: TailParameters<PostsResource['byUser']>
  ): HydratedMethodResult<PostsResource['byUser']>;
}

/** Безопасные проверки типа вложения. */
export interface HydratedAttachmentActions {
  /** Является ли вложение изображением. */
  isImage(): this is this & { type: typeof import('itd-api').AttachmentType.Image };
  /** Является ли вложение видео. */
  isVideo(): this is this & { type: typeof import('itd-api').AttachmentType.Video };
  /** Является ли вложение аудио. */
  isAudio(): this is this & { type: typeof import('itd-api').AttachmentType.Audio };
}

/** Автор с методами работы с его профилем. */
export type HydratedAuthor<T extends Author = Author> = T & HydratedUserActions;

/** Пользователь из списка с методами работы с его профилем. */
export type HydratedUserSummary<T extends UserSummary = UserSummary> = T & HydratedUserActions;

/** Участник уведомления с методами работы с его профилем. */
export type HydratedActor<T extends Actor = Actor> = T & HydratedUserActions;

/** Адресат ответа с методами работы с его профилем. */
export type HydratedCommentReplyTo<T extends CommentReplyTo = CommentReplyTo> = T &
  HydratedUserActions;

/** Профиль с методами действий над пользователем. */
export type HydratedProfile<T extends Profile = Profile> = T & HydratedUserActions;

/** Вложение с проверками его типа. */
export type HydratedAttachment<T extends Attachment = Attachment> = T & HydratedAttachmentActions;

/** Комментарий с действиями и гидратированными вложенными моделями. */
export type HydratedComment<T extends Comment = Comment> = Omit<
  T,
  'author' | 'attachments' | 'replies' | 'replyTo'
> & {
  author: HydratedAuthor<T['author']>;
  attachments?: HydratedAttachment[];
  replies?: HydratedComment[];
  replyTo?: HydratedCommentReplyTo;
} & HydratedCommentActions;

/** Пост с действиями и гидратированными вложенными моделями. */
export type HydratedPost<T extends Post = Post> = Omit<
  T,
  'author' | 'attachments' | 'wallRecipient' | 'originalPost' | 'comments'
> & {
  author: HydratedAuthor<T['author']>;
  attachments: HydratedAttachment[];
  wallRecipient?: HydratedAuthor | null;
  originalPost?: HydratedPost | null;
  comments?: HydratedComment[];
} & HydratedPostActions;

/** Страница, элементы которой получили методы гидратации. */
export type HydratedPage<T> = Omit<Page<T>, 'items'> & { items: Array<HydrateValue<T>> };

/** Одноразовый перебор, возвращающий гидратированные элементы и страницы. */
export type HydratedPaginator<T> = {
  [Key in keyof Paginator<T>]: Paginator<T>[Key] extends (...args: infer Args) => infer Result
    ? (...args: Args) => HydrateValue<Result>
    : HydrateValue<Paginator<T>[Key]>;
};

/** Преобразует тип результата клиента в его гидратированный вариант. */
export type HydrateValue<T> =
  T extends Promise<infer Value>
    ? Promise<HydrateValue<Value>>
    : T extends Paginator<infer Item>
      ? HydratedPaginator<Item>
      : T extends AsyncGenerator<infer Yield, infer Return, infer Next>
        ? AsyncGenerator<HydrateValue<Yield>, HydrateValue<Return>, Next>
        : T extends AsyncIterable<infer Item>
          ? AsyncIterable<HydrateValue<Item>>
          : T extends Page<infer Item>
            ? HydratedPage<Item>
            : T extends Post
              ? HydratedPost<T>
              : T extends Comment
                ? HydratedComment<T>
                : T extends MyProfile | PublicProfile
                  ? HydratedProfile<T>
                  : T extends Author
                    ? HydratedAuthor<T>
                    : T extends UserSummary
                      ? HydratedUserSummary<T>
                      : T extends Actor
                        ? HydratedActor<T>
                        : T extends CommentReplyTo
                          ? HydratedCommentReplyTo<T>
                          : T extends Attachment
                            ? HydratedAttachment<T>
                            : T extends Array<infer Item>
                              ? Array<HydrateValue<Item>>
                              : T extends ReadonlyArray<infer Item>
                                ? ReadonlyArray<HydrateValue<Item>>
                                : T extends (...args: never[]) => unknown
                                  ? T
                                  : T extends object
                                    ? { [Key in keyof T]: HydrateValue<T[Key]> }
                                    : T;

/** Ресурс клиента, методы которого возвращают гидратированные результаты. */
export type HydratedResource<Resource> = {
  [Key in keyof Resource]: Resource[Key] extends (...args: infer Args) => infer Result
    ? (...args: Args) => HydrateValue<Result>
    : HydrateValue<Resource[Key]>;
};

/**
 * Вариант клиента с гидратированными результатами ресурсов.
 *
 * @example
 * ```ts
 * type MyClient = HydrateFlavor<ItdClient>;
 * ```
 */
export type HydrateFlavor<Client extends ItdClient = ItdClient> = Omit<
  Client,
  HydratableResource
> & {
  readonly [Key in Extract<keyof Client, HydratableResource>]: HydratedResource<Client[Key]>;
};
