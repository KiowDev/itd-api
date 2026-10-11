import type {
  Actor,
  Author,
  CommentReplyTo,
  PostsResource,
  Profile,
  UserSummary,
  UsersResource,
} from 'itd-api';
import type { HydratedMethodResult, TailParameters } from '../../actions/action.types.js';
import type { HydratedModel } from '../model.types.js';

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
