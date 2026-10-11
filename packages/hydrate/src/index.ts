export type {
  HydratedEventContext,
  HydratedEventHandler,
  HydratedEventMiddleware,
  HydratedNotificationContext,
  HydratedNotificationEvent,
  HydratedNotificationEvents,
  HydratedNotificationEventsEvent,
  HydratedNotificationFilter,
  HydratedNotificationSelector,
} from './facades/events.types.js';
export { hydrateClient } from './hydrate.factory.js';
export type {
  HydratedAttachment,
  HydratedAttachmentActions,
} from './models/attachment/attachment.types.js';
export type { HydratedComment, HydratedCommentActions } from './models/comment/comment.types.js';
export type {
  HydratedModel,
  HydratedPage,
  HydratedPaginator,
  HydrateValue,
} from './models/model.types.js';
export type {
  HydratedCommentReference,
  HydratedNotification,
  HydratedNotificationActions,
} from './models/notification/notification.types.js';
export type {
  HydratedOriginalPost,
  HydratedPost,
  HydratedPostActions,
} from './models/post/post.types.js';
export type {
  HydratedQrLoginTarget,
  HydratedQrLoginTargetActions,
} from './models/qr-login/qr-login.types.js';
export type {
  HydratedShopDeliveryCity,
  HydratedShopDeliveryCityActions,
} from './models/shop-delivery-city/shop-delivery-city.types.js';
export type {
  HydratedActor,
  HydratedAuthor,
  HydratedCommentReplyTo,
  HydratedProfile,
  HydratedUserActions,
  HydratedUserReference,
  HydratedUserSummary,
} from './models/user/user.types.js';
export { HydratableResource } from './results/results.constants.js';
export type {
  HydratedAuthResource,
  HydratedNotificationsResource,
  HydratedResource,
  HydrateFlavor,
} from './results/results.types.js';
