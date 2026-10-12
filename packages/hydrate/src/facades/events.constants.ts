import { ModelKind } from '../models/model.constants.js';
import { fields, model } from '../shapes/shape.factory.js';

/** Форма события `notification`. */
export const NOTIFICATION_EVENT_SHAPE = fields({ notification: model(ModelKind.Notification) });

/** Форма обновления потока типа `NotificationUpdateType.Notification`. */
export const NOTIFICATION_UPDATE_SHAPE = fields({ data: NOTIFICATION_EVENT_SHAPE });
