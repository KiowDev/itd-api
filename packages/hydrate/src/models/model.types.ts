import type { HydratedFields } from '../shapes/shape.types.js';
import type { HydratedAttachmentActions } from './attachment/attachment.types.js';
import type { HydratedCommentActions } from './comment/comment.types.js';
import { type MODEL_SCHEMAS, ModelKind } from './model.constants.js';
import type { HydratedNotificationActions } from './notification/notification.types.js';
import type { HydratedPostActions } from './post/post.types.js';
import type { HydratedQrLoginTargetActions } from './qr-login/qr-login.types.js';
import type { HydratedShopDeliveryCityActions } from './shop-delivery-city/shop-delivery-city.types.js';
import type { HydratedUserActions } from './user/user.types.js';

/** Поля модели вида `K`, в которых лежат другие модели. */
export type ModelSchema<K extends ModelKind> = (typeof MODEL_SCHEMAS)[K];

/** Действия каждого вида модели. */
export interface ModelActions {
  [ModelKind.Post]: HydratedPostActions;
  [ModelKind.Comment]: HydratedCommentActions;
  [ModelKind.User]: HydratedUserActions;
  [ModelKind.Attachment]: HydratedAttachmentActions;
  [ModelKind.Notification]: HydratedNotificationActions;
  [ModelKind.ShopDeliveryCity]: HydratedShopDeliveryCityActions;
  [ModelKind.QrLoginTarget]: HydratedQrLoginTargetActions;
}

/** Модель вида `K`: поля схемы гидратированы, остальные сохранены, действия добавлены. */
export type HydratedModel<K extends ModelKind, Raw> = Raw extends unknown
  ? HydratedFields<Raw, ModelSchema<K>, keyof ModelActions[K]> & ModelActions[K]
  : never;
