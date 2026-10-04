import { MockDomainError } from '../shared/domain.errors.js';
import type { MockStore } from '../store/mock.store.js';
import type { NotificationInput, NotificationRecord } from './notifications.types.js';

type NotificationListener = (record: NotificationRecord) => void;

/** Хранит уведомления и оповещает подписчиков о новых. Когда уведомлять, решают другие сервисы. @internal */
export class NotificationService {
  readonly #store: MockStore;
  readonly #listeners = new Set<NotificationListener>();

  constructor(store: MockStore) {
    this.#store = store;
  }

  /** Создаёт уведомление. Действие над собой и неизвестный получатель уведомления не создают. */
  notify(input: NotificationInput): NotificationRecord | undefined {
    if (input.recipientId === input.actorId || !this.#store.users.has(input.recipientId)) {
      return undefined;
    }
    const createdAt = this.#store.now();
    const record: NotificationRecord = {
      id: this.#store.nextNotificationId(),
      userId: input.recipientId,
      type: input.type,
      actorIds: [input.actorId],
      entityId: input.entityId,
      parentEntityId: input.parentEntityId ?? null,
      preview: input.preview ?? null,
      isRead: false,
      createdAt,
      updatedAt: createdAt,
    };
    this.#store.notifications.unshift(record);
    for (const listener of this.#listeners) listener(record);
    return record;
  }

  /** Подписывает на новые уведомления и возвращает функцию отписки. */
  onCreated(listener: NotificationListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Уведомления пользователя, сначала новые. */
  forUser(userId: string): NotificationRecord[] {
    return this.#store.notifications.filter((record) => record.userId === userId);
  }

  unreadCount(userId: string): number {
    return this.#store.notifications.filter((record) => record.userId === userId && !record.isRead)
      .length;
  }

  /** Возвращает, сколько уведомлений стало прочитанными. */
  markRead(userId: string, notificationId: string): number {
    const record = this.#store.notifications.find(
      (candidate) => candidate.userId === userId && candidate.id === notificationId,
    );
    if (!record) throw MockDomainError.notFound('Notification not found');
    return this.#setRead([record]);
  }

  markMany(userId: string, notificationIds: ReadonlySet<string>): number {
    return this.#setRead(this.forUser(userId).filter((record) => notificationIds.has(record.id)));
  }

  markAll(userId: string): number {
    return this.#setRead(this.forUser(userId));
  }

  #setRead(records: readonly NotificationRecord[]): number {
    let marked = 0;
    for (const record of records) {
      if (record.isRead) continue;
      record.isRead = true;
      record.updatedAt = this.#store.now();
      marked += 1;
    }
    return marked;
  }
}
