import type {
  Actor,
  Attachment,
  Author,
  Comment,
  CommentReplyTo,
  MyProfile,
  Notification,
  OriginalPost,
  Page,
  Paginator,
  Post,
  PublicProfile,
  ShopDeliveryCity,
  UserSummary,
} from 'itd-api';
import type { HydratedAttachment } from './attachment/attachment.types.js';
import type { HydratedComment } from './comment/comment.types.js';
import type { HydratedNotification } from './notification/notification.types.js';
import type { HydratedOriginalPost, HydratedPost } from './post/post.types.js';
import type { HydratedShopDeliveryCity } from './shop-delivery-city/shop-delivery-city.types.js';
import type {
  HydratedActor,
  HydratedAuthor,
  HydratedCommentReplyTo,
  HydratedProfile,
  HydratedUserReference,
  HydratedUserSummary,
} from './user/user.types.js';

/** Рекурсивно гидратирует поля модели и добавляет указанный набор действий. */
export type HydratedModel<Model, Actions extends object = object> = Omit<
  { [Key in keyof Model]: HydrateValue<Model[Key]> },
  keyof Actions
> &
  Actions;

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
              : T extends OriginalPost
                ? HydratedOriginalPost<T>
                : T extends Comment
                  ? HydratedComment<T>
                  : T extends Notification
                    ? HydratedNotification<T>
                    : T extends ShopDeliveryCity
                      ? HydratedShopDeliveryCity<T>
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
