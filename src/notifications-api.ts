import type { HttpClient } from './core/execution/http.js';
import type { NotificationEvents } from './realtime/stream.js';
import { NotificationsResource } from './resources/notifications.js';

/** Уведомления полного клиента: REST-методы и стабильный канал событий. */
export interface NotificationsApi extends NotificationsResource {
  /** Один канал событий уведомлений на всё время жизни клиента. */
  readonly events: NotificationEvents;
}

class ClientNotifications extends NotificationsResource implements NotificationsApi {
  readonly #createEvents: (resource: NotificationsResource) => NotificationEvents;
  #events: NotificationEvents | undefined;

  constructor(
    http: HttpClient,
    createEvents: (resource: NotificationsResource) => NotificationEvents,
  ) {
    super(http);
    this.#createEvents = createEvents;
  }

  get events(): NotificationEvents {
    this.#events ??= this.#createEvents(this);
    return this.#events;
  }
}

/** Создаёт API уведомлений полного клиента. @internal */
export function createNotificationsApi(
  http: HttpClient,
  createEvents: (resource: NotificationsResource) => NotificationEvents,
): NotificationsApi {
  return new ClientNotifications(http, createEvents);
}
