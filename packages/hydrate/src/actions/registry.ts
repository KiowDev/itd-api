import { ATTACHMENT_ACTIONS } from '../models/attachment/attachment.actions.js';
import { COMMENT_ACTIONS } from '../models/comment/comment.actions.js';
import { ModelKind } from '../models/model.constants.js';
import { NOTIFICATION_ACTIONS } from '../models/notification/notification.actions.js';
import { POST_ACTIONS } from '../models/post/post.actions.js';
import { SHOP_DELIVERY_CITY_ACTIONS } from '../models/shop-delivery-city/shop-delivery-city.actions.js';
import { USER_ACTIONS } from '../models/user/user.actions.js';
import type { ModelAction } from '../runtime/records.types.js';

export function actionsFor(kind: ModelKind): Readonly<Record<string, ModelAction>> {
  if (kind === ModelKind.Post) return POST_ACTIONS;
  if (kind === ModelKind.Comment) return COMMENT_ACTIONS;
  if (kind === ModelKind.Profile || kind === ModelKind.User) return USER_ACTIONS;
  if (kind === ModelKind.Attachment) return ATTACHMENT_ACTIONS;
  if (kind === ModelKind.ShopDeliveryCity) return SHOP_DELIVERY_CITY_ACTIONS;
  return NOTIFICATION_ACTIONS;
}
