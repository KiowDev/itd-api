import { list, model } from '../shapes/shape.factory.js';
import type { FieldShapes } from '../shapes/shape.types.js';

export const ModelKind = Object.freeze({
  Post: 'post',
  Comment: 'comment',
  User: 'user',
  Attachment: 'attachment',
  Notification: 'notification',
  ShopDeliveryCity: 'shop-delivery-city',
  QrLoginTarget: 'qr-login-target',
} as const);
export type ModelKind = (typeof ModelKind)[keyof typeof ModelKind];

const user = model(ModelKind.User);
const attachments = list(model(ModelKind.Attachment));

/** Поля каждого вида модели, в которых лежат другие модели. */
export const MODEL_SCHEMAS = {
  [ModelKind.Post]: {
    author: user,
    wallRecipient: user,
    originalPost: model(ModelKind.Post),
    comments: list(model(ModelKind.Comment)),
    attachments,
  },
  [ModelKind.Comment]: {
    author: user,
    replyTo: user,
    replies: list(model(ModelKind.Comment)),
    attachments,
  },
  [ModelKind.User]: {},
  [ModelKind.Attachment]: {},
  [ModelKind.Notification]: { actors: list(user) },
  [ModelKind.ShopDeliveryCity]: {},
  [ModelKind.QrLoginTarget]: {},
} satisfies { readonly [K in ModelKind]: FieldShapes };
