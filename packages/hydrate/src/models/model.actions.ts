import type { ModelAction } from '../actions/action.types.js';
import { ATTACHMENT_ACTIONS } from './attachment/attachment.actions.js';
import { COMMENT_ACTIONS } from './comment/comment.actions.js';
import { HASHTAG_ACTIONS } from './hashtag/hashtag.actions.js';
import { ModelKind } from './model.constants.js';
import { NOTIFICATION_ACTIONS } from './notification/notification.actions.js';
import { POST_ACTIONS } from './post/post.actions.js';
import { QR_LOGIN_TARGET_ACTIONS } from './qr-login/qr-login.actions.js';
import { SHOP_DELIVERY_CITY_ACTIONS } from './shop-delivery-city/shop-delivery-city.actions.js';
import { USER_ACTIONS } from './user/user.actions.js';

/** Действия каждого вида модели. */
export const MODEL_ACTIONS = Object.freeze({
  [ModelKind.Post]: POST_ACTIONS,
  [ModelKind.Comment]: COMMENT_ACTIONS,
  [ModelKind.User]: USER_ACTIONS,
  [ModelKind.Attachment]: ATTACHMENT_ACTIONS,
  [ModelKind.Notification]: NOTIFICATION_ACTIONS,
  [ModelKind.ShopDeliveryCity]: SHOP_DELIVERY_CITY_ACTIONS,
  [ModelKind.QrLoginTarget]: QR_LOGIN_TARGET_ACTIONS,
  [ModelKind.Hashtag]: HASHTAG_ACTIONS,
} satisfies { readonly [K in ModelKind]: Readonly<Record<string, ModelAction>> });
