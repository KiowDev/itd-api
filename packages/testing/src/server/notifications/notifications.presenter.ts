import type { Notification } from 'itd-api';
import { notificationFixture } from '../../fixtures/models.fixtures.js';
import type { UserPresenter } from '../users/users.presenter.js';
import type { UserService } from '../users/users.service.js';
import type { UserRecord } from '../users/users.types.js';
import type { NotificationRecord } from './notifications.types.js';

/** Уведомления в форме ответов API. Участники берутся из текущих профилей. @internal */
export class NotificationPresenter {
  readonly #users: UserService;
  readonly #userPresenter: UserPresenter;

  constructor(users: UserService, userPresenter: UserPresenter) {
    this.#users = users;
    this.#userPresenter = userPresenter;
  }

  notification(record: NotificationRecord): Notification {
    const actors = record.actorIds
      .map((id) => this.#users.get(id))
      .filter((user): user is UserRecord => user !== undefined)
      .map((user) => this.#userPresenter.reference(user));
    return notificationFixture({
      id: record.id,
      type: record.type,
      rawType: record.type,
      actors,
      entityId: record.entityId,
      parentEntityId: record.parentEntityId,
      preview: record.preview,
      isRead: record.isRead,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });
  }
}
