import type { UserBase } from 'itd-api';
import type { ResourceAction } from '../../actions/action.types.js';
import type { ModelKind } from '../model.constants.js';
import type { HydratedModel } from '../model.types.js';

/** Действия над пользователем. Идентификатор пользователя подставляется автоматически. */
export interface HydratedUserActions {
  /** Загружает полный профиль. */
  readonly get: ResourceAction<'users', 'get'>;
  /** Подписывается на пользователя. */
  readonly follow: ResourceAction<'users', 'follow'>;
  /** Отписывается от пользователя. */
  readonly unfollow: ResourceAction<'users', 'unfollow'>;
  /** Блокирует пользователя. */
  readonly block: ResourceAction<'users', 'block'>;
  /** Снимает блокировку. */
  readonly unblock: ResourceAction<'users', 'unblock'>;
  /** Загружает страницу стены. */
  readonly getPosts: ResourceAction<'posts', 'byUser'>;
  /** Перебирает стену постранично. */
  readonly iteratePosts: ResourceAction<'posts', 'iterateByUser'>;
  /** Загружает страницу постов с реакцией пользователя. */
  readonly getLikedPosts: ResourceAction<'posts', 'likedByUser'>;
  /** Перебирает посты с реакцией пользователя постранично. */
  readonly iterateLikedPosts: ResourceAction<'posts', 'iterateLikedByUser'>;
  /** Загружает страницу подписчиков. */
  readonly getFollowers: ResourceAction<'users', 'followers'>;
  /** Перебирает подписчиков постранично. */
  readonly iterateFollowers: ResourceAction<'users', 'iterateFollowers'>;
  /** Загружает страницу подписок. */
  readonly getFollowing: ResourceAction<'users', 'following'>;
  /** Перебирает подписки постранично. */
  readonly iterateFollowing: ResourceAction<'users', 'iterateFollowing'>;
}

/** Пользователь любого вида — автор, участник уведомления, профиль — с действиями над ним. */
export type HydratedUser<T extends UserBase = UserBase> = HydratedModel<typeof ModelKind.User, T>;
