import type { Notification } from 'itd-api';

/** Уведомление в хранилище mock-server. Участники хранятся ссылками на пользователей. @internal */
export interface NotificationRecord {
  id: string;
  userId: string;
  type: Notification['type'];
  actorIds: string[];
  entityId: string | null;
  parentEntityId: string | null;
  preview: string | null;
  isRead: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Что произошло и с кем: из этого сервис собирает запись уведомления. @internal */
export interface NotificationInput {
  recipientId: string;
  type: Notification['type'];
  actorId: string;
  entityId: string | null;
  parentEntityId?: string | null;
  preview?: string | null;
}
