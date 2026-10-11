export const ModelKind = Object.freeze({
  Post: 'post',
  Comment: 'comment',
  Profile: 'profile',
  User: 'user',
  Attachment: 'attachment',
  Notification: 'notification',
  ShopDeliveryCity: 'shop-delivery-city',
} as const);
export type ModelKind = (typeof ModelKind)[keyof typeof ModelKind];
