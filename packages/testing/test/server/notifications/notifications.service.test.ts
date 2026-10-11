import { NotificationType } from 'itd-api';
import { describe, expect, it, vi } from 'vitest';
import { makeRuntime } from '../test-runtime.utils.js';
import { ALICE, BOB } from '../test-server.utils.js';

const follow = (recipientId: string, actorId: string) => ({
  recipientId,
  type: NotificationType.Follow,
  actorId,
  entityId: actorId,
});

describe('NotificationService', () => {
  it('не уведомляет о действии над собой и неизвестного получателя', () => {
    const { notifications } = makeRuntime().services;

    expect(notifications.notify(follow(ALICE, ALICE))).toBeUndefined();
    expect(notifications.notify(follow('missing', ALICE))).toBeUndefined();
    expect(notifications.forUser(ALICE)).toEqual([]);
  });

  it('хранит участников идентификаторами и оповещает подписчиков', () => {
    const { notifications } = makeRuntime().services;
    const listener = vi.fn();
    notifications.onCreated(listener);

    const record = notifications.notify(follow(BOB, ALICE));

    expect(record).toMatchObject({ userId: BOB, actorIds: [ALICE], isRead: false });
    expect(listener).toHaveBeenCalledWith(record);
  });

  it('считает только впервые прочитанные уведомления', () => {
    const { notifications } = makeRuntime().services;
    const first = notifications.notify(follow(BOB, ALICE));
    notifications.notify(follow(BOB, ALICE));

    expect(notifications.markRead(BOB, first?.id ?? '')).toBe(1);
    expect(notifications.markRead(BOB, first?.id ?? '')).toBe(0);
    expect(notifications.markAll(BOB)).toBe(1);
    expect(notifications.unreadCount(BOB)).toBe(0);
  });

  it('не отмечает чужое уведомление', () => {
    const { notifications } = makeRuntime().services;
    const record = notifications.notify(follow(BOB, ALICE));

    expect(() => notifications.markRead(ALICE, record?.id ?? '')).toThrow(
      expect.objectContaining({ status: 404, code: 'NOT_FOUND' }),
    );
  });
});
