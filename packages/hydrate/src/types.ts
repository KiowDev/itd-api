import type {
  Actor,
  Attachment,
  Author,
  Comment,
  CommentReplyTo,
  CommentsResource,
  ItdClient,
  ItdRealtime,
  Listener,
  MyProfile,
  Notification,
  NotificationEvent,
  NotificationType,
  Page,
  Paginator,
  Post,
  PostsResource,
  Profile,
  PublicProfile,
  RealtimeContext,
  RealtimeContextBase,
  RealtimeEvents,
  RealtimeHandler,
  RealtimeMiddleware,
  RealtimeNext,
  RealtimeNotificationContext,
  RealtimeNotificationFilter,
  RealtimeNotificationUpdate,
  RealtimeOptions,
  RealtimeSequentializer,
  RealtimeUpdateOfType,
  RealtimeUpdateType,
  Unsubscribe,
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

/** Действия над уведомлением. */
export interface HydratedNotificationActions {
  /** Загружает пост, к которому относится уведомление. */
  getPost(...args: TailParameters<PostsResource['get']>): Promise<HydratedPost | undefined>;
  /** Комментарий, к которому относится уведомление. */
  readonly comment?: HydratedCommentReference;
}

/** Рекурсивно гидратирует поля модели и добавляет указанный набор действий. */
export type HydratedModel<Model, Actions extends object = object> = Omit<
  { [Key in keyof Model]: HydrateValue<Model[Key]> },
  keyof Actions
> &
  Actions;

/** Автор с методами работы с его профилем. */
export type HydratedAuthor<T extends Author = Author> = HydratedModel<T, HydratedUserActions>;

/** Пользователь из списка с методами работы с его профилем. */
export type HydratedUserSummary<T extends UserSummary = UserSummary> = HydratedModel<
  T,
  HydratedUserActions
>;

/** Участник уведомления с методами работы с его профилем. */
export type HydratedActor<T extends Actor = Actor> = HydratedModel<T, HydratedUserActions>;

/** Адресат ответа с методами работы с его профилем. */
export type HydratedCommentReplyTo<T extends CommentReplyTo = CommentReplyTo> = HydratedModel<
  T,
  HydratedUserActions
>;

/** Профиль с методами действий над пользователем. */
export type HydratedProfile<T extends Profile = Profile> = HydratedModel<T, HydratedUserActions>;

/** Объект со ссылкой на пользователя и действиями над ним. */
export type HydratedUserReference<T extends object = { username: string }> = HydratedModel<
  T,
  HydratedUserActions
>;

/** Вложение с проверками его типа. */
export type HydratedAttachment<T extends Attachment = Attachment> = HydratedModel<
  T,
  HydratedAttachmentActions
>;

/** Комментарий с действиями и гидратированными вложенными моделями. */
export type HydratedComment<T extends Comment = Comment> = HydratedModel<T, HydratedCommentActions>;

/** Пост с действиями и гидратированными вложенными моделями. */
export type HydratedPost<T extends Post = Post> = HydratedModel<T, HydratedPostActions>;

/** Ссылка на комментарий из уведомления. */
export type HydratedCommentReference = Readonly<{ id: string }> & HydratedCommentActions;

/** Уведомление с действиями над связанными сущностями. */
export type HydratedNotification<T extends Notification = Notification> = HydratedModel<
  T,
  HydratedNotificationActions
>;

/** Страница, элементы которой получили методы гидратации. */
export type HydratedPage<T> = HydratedModel<Page<T>>;

/** Одноразовый перебор, возвращающий гидратированные элементы и страницы. */
export type HydratedPaginator<T> = {
  [Key in keyof Paginator<T>]: Paginator<T>[Key] extends (...args: infer Args) => infer Result
    ? (...args: Args) => HydrateValue<Result>
    : HydrateValue<Paginator<T>[Key]>;
};

/** Преобразует тип результата клиента в его гидратированный вариант. */
export type HydrateValue<T> = T extends
  | string
  | number
  | boolean
  | bigint
  | symbol
  | null
  | undefined
  ? T
  : T extends Promise<infer Value>
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
                : T extends Notification
                  ? HydratedNotification<T>
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
                              : T extends { userId: string } | { username: string }
                                ? HydratedUserReference<T>
                                : T extends readonly unknown[]
                                  ? { [Key in keyof T]: HydrateValue<T[Key]> }
                                  : T extends (...args: never[]) => unknown
                                    ? T
                                    : T extends object
                                      ? { [Key in keyof T]: HydrateValue<T[Key]> }
                                      : T;

/** Событие уведомления с гидратированной моделью. */
export type HydratedNotificationEvent = HydratedModel<NotificationEvent>;

/** Контекст realtime с гидратированным обновлением и потоком. */
export type HydratedRealtimeContext<C extends RealtimeContextBase = RealtimeContext> =
  HydratedModel<
    C,
    {
      readonly update: HydrateValue<C['update']>;
      readonly stream: C extends RealtimeContext ? HydratedRealtime : C['stream'];
      readonly raw: C['raw'];
    }
  >;

/** Контекст уведомления с типом, суженным селектором. */
export type HydratedRealtimeNotificationContext<T extends NotificationType = NotificationType> =
  HydratedRealtimeContext<RealtimeNotificationContext<T>>;

/** Асинхронный обработчик гидратированного обновления. */
export type HydratedRealtimeHandler<C extends RealtimeContextBase = RealtimeContext> = (
  context: HydratedRealtimeContext<C>,
) => ReturnType<RealtimeHandler<C>>;

/** Промежуточный обработчик гидратированных обновлений. */
export type HydratedRealtimeMiddleware<C extends RealtimeContextBase = RealtimeContext> = (
  context: HydratedRealtimeContext<C>,
  next: RealtimeNext,
) => ReturnType<RealtimeMiddleware<C>>;

/** Условия отбора гидратированных уведомлений. */
export type HydratedRealtimeNotificationFilter<T extends NotificationType = NotificationType> =
  Omit<RealtimeNotificationFilter<T>, 'predicate'> & {
    predicate?: (context: HydratedRealtimeNotificationContext<T>) => boolean;
  };

/** Краткая или объектная форма фильтра гидратированных уведомлений. */
export type HydratedRealtimeNotificationSelector<T extends NotificationType = NotificationType> =
  | T
  | readonly T[]
  | HydratedRealtimeNotificationFilter<T>;

/** Значение события гидратированного потока. */
export type HydratedRealtimeEvent<K extends keyof RealtimeEvents> = K extends 'notification'
  ? HydratedNotificationEvent
  : K extends 'middlewareError' | 'handlerError'
    ? RealtimeEvents[K] extends infer Event extends { context: RealtimeContext }
      ? Omit<Event, 'context'> & { context: HydratedRealtimeContext<Event['context']> }
      : never
    : RealtimeEvents[K];

/** Настройки realtime с гидратированным контекстом функции последовательности. */
export type HydratedRealtimeOptions = Omit<RealtimeOptions, 'sequentialize'> & {
  sequentialize?: (context: HydratedRealtimeContext) => ReturnType<RealtimeSequentializer>;
};

/** Поток, передающий гидратированные уведомления и контексты. */
export type HydratedRealtime = {
  on<K extends keyof RealtimeEvents>(
    event: K,
    listener: Listener<HydratedRealtimeEvent<K>>,
  ): Unsubscribe;
  once<K extends keyof RealtimeEvents>(
    event: K,
    listener: Listener<HydratedRealtimeEvent<K>>,
  ): Unsubscribe;
  use(middleware: HydratedRealtimeMiddleware): Unsubscribe;
  onUpdate(handler: HydratedRealtimeHandler): Unsubscribe;
  onUpdate<T extends RealtimeUpdateType>(
    type: T,
    handler: HydratedRealtimeHandler<RealtimeContext<RealtimeUpdateOfType<T>>>,
  ): Unsubscribe;
  onUpdate<C extends RealtimeContext>(
    guard: (context: HydratedRealtimeContext) => context is HydratedRealtimeContext<C>,
    handler: HydratedRealtimeHandler<C>,
  ): Unsubscribe;
  onUpdate(
    predicate: (context: HydratedRealtimeContext) => boolean,
    handler: HydratedRealtimeHandler,
  ): Unsubscribe;
  onNotification<T extends NotificationType>(
    selector: HydratedRealtimeNotificationSelector<T>,
    handler: HydratedRealtimeHandler<RealtimeContext<RealtimeNotificationUpdate<T>>>,
  ): Unsubscribe;
  onNotification<C extends RealtimeNotificationContext>(
    guard: (context: HydratedRealtimeNotificationContext) => context is HydratedRealtimeContext<C>,
    handler: HydratedRealtimeHandler<C>,
  ): Unsubscribe;
  onNotification(
    predicate: (context: HydratedRealtimeNotificationContext) => boolean,
    handler: HydratedRealtimeHandler<RealtimeNotificationContext>,
  ): Unsubscribe;
} & ItdRealtime;

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
  HydratableResource | keyof Pick<ItdClient, 'realtime'>
> & {
  readonly [Key in Extract<keyof Client, HydratableResource>]: HydratedResource<Client[Key]>;
} & {
  realtime(options?: HydratedRealtimeOptions): HydratedRealtime;
};
