import { MockEventTransport } from '../../events/mock-event.transport.js';
import type { UserRecord } from '../users/users.types.js';
import type { NotificationPresenter } from './notifications.presenter.js';
import type { NotificationService } from './notifications.service.js';
import type { NotificationRecord } from './notifications.types.js';

/** Доставляет новые уведомления в подключённые транспорты событий получателя. @internal */
export class NotificationDelivery {
  readonly #transports = new Map<string, Set<MockEventTransport>>();
  readonly #notifications: NotificationService;
  readonly #presenter: NotificationPresenter;

  constructor(notifications: NotificationService, presenter: NotificationPresenter) {
    this.#notifications = notifications;
    this.#presenter = presenter;
    notifications.onCreated((record) => this.#deliver(record));
  }

  /** Создаёт транспорт, который получает уведомления пользователя. */
  connect(user: UserRecord): MockEventTransport {
    const transport = new MockEventTransport();
    const transports = this.#transports.get(user.profile.id) ?? new Set();
    transports.add(transport);
    this.#transports.set(user.profile.id, transports);
    return transport;
  }

  #deliver(record: NotificationRecord): void {
    const transports = this.#transports.get(record.userId);
    if (!transports) return;
    const notification = this.#presenter.notification(record);
    const unread = this.#notifications.unreadCount(record.userId);
    for (const transport of transports) {
      if (transport.connected) transport.notification(notification, unread);
    }
  }
}
