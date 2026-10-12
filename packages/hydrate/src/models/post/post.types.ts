import type { Post, PostBase } from 'itd-api';
import type { ResourceAction } from '../../actions/action.types.js';
import type { ModelKind } from '../model.constants.js';
import type { HydratedModel } from '../model.types.js';

/** Действия над постом. Идентификатор поста подставляется автоматически. */
export interface HydratedPostActions {
  /** Загружает свежее состояние поста. */
  readonly get: ResourceAction<'posts', 'get'>;
  /** Ставит реакцию. */
  readonly like: ResourceAction<'posts', 'like'>;
  /** Убирает реакцию. */
  readonly unlike: ResourceAction<'posts', 'unlike'>;
  /** Добавляет комментарий. */
  readonly comment: ResourceAction<'posts', 'comment'>;
  /** Добавляет голосовой комментарий. */
  readonly voiceComment: ResourceAction<'posts', 'voiceComment'>;
  /** Загружает страницу комментариев. */
  readonly getComments: ResourceAction<'posts', 'comments'>;
  /** Перебирает комментарии постранично. */
  readonly iterateComments: ResourceAction<'posts', 'iterateComments'>;
  /** Изменяет текст поста. */
  readonly update: ResourceAction<'posts', 'update'>;
  /** Голосует в опросе поста. */
  readonly vote: ResourceAction<'posts', 'vote'>;
  /** Делает репост. */
  readonly repost: ResourceAction<'posts', 'repost'>;
  /** Отменяет репост. */
  readonly unrepost: ResourceAction<'posts', 'unrepost'>;
  /** Удаляет пост. */
  readonly remove: ResourceAction<'posts', 'remove'>;
  /** Восстанавливает удалённый пост. */
  readonly restore: ResourceAction<'posts', 'restore'>;
  /** Закрепляет пост. */
  readonly pin: ResourceAction<'posts', 'pin'>;
  /** Открепляет пост. */
  readonly unpin: ResourceAction<'posts', 'unpin'>;
}

/** Пост ленты или пост, на который ссылается репост, с действиями и гидратированными моделями. */
export type HydratedPost<T extends PostBase = Post> = HydratedModel<typeof ModelKind.Post, T>;
