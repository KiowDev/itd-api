import { describe, expect, it, vi } from 'vitest';
import {
  type EventTransportFrame,
  NotificationEvents,
  NotificationUpdateOrigin,
  NotificationUpdateType,
} from '../../src/index.js';
import { makeStream, notification, TestTransport } from './helpers.js';

describe('event updates', () => {
  it('проверяет настройки dispatch и фильтров', () => {
    expect(() => makeStream(new TestTransport(), { concurrency: 0 })).toThrow(
      /concurrency должен быть больше нуля/,
    );

    const stream = makeStream(new TestTransport());
    expect(() => stream.onUpdate('invalid' as 'notification', () => {})).toThrow(
      /Неизвестный тип обновления потока/,
    );
    expect(() =>
      stream.onNotification([] as unknown as readonly ['post_comment'], () => {}),
    ).toThrow(/Список типов уведомлений/);
    expect(() => stream.use({} as never)).toThrow(/объект с middleware/);
  });

  it('создаёт один логический update на известный транспортный кадр', async () => {
    const transport = new TestTransport();
    const stream = makeStream(transport);
    const updates: string[] = [];
    const handled: string[] = [];
    const messages: string[] = [];
    const counts: number[] = [];

    stream.use(async (context, next) => {
      updates.push(context.update.type);
      await next();
    });
    stream.on('message', ({ name }) => messages.push(name));
    stream.onUpdate(({ update }) => handled.push(update.type));
    stream.on('unreadCount', (count) => counts.push(count));

    await stream.connect();
    transport.emit({ name: 'connected', data: { userId: 'user-1' } });
    transport.emit(notification('n1'));
    transport.emit({ name: 'custom_event', data: { value: 1 } });
    await stream.drain();

    expect(updates).toEqual([NotificationUpdateType.Notification, NotificationUpdateType.Unknown]);
    expect(handled).toEqual(updates);
    expect(messages).toEqual(['connected', 'notification', 'custom_event']);
    expect(counts).toEqual([3]);
    stream.disconnect();
  });

  it('не создаёт update из unread_count без счётчика', async () => {
    const transport = new TestTransport();
    const stream = makeStream(transport);
    const updates = vi.fn();
    stream.onUpdate('unreadCount', updates);

    await stream.connect();
    transport.emit({ name: 'unread_count', data: {} });
    await stream.drain();

    expect(updates).not.toHaveBeenCalled();
    stream.disconnect();
  });

  it('передаёт начальную REST-синхронизацию через middleware без raw frame', async () => {
    const transport = new TestTransport();
    const stream = new NotificationEvents(
      {
        connection: {
          baseUrl: 'https://itd.test',
          authorize: true,
          fetch: globalThis.fetch,
          clock: {
            now: () => Date.now(),
            schedule: (callback, delay) => {
              const timer = setTimeout(callback, delay);
              return () => clearTimeout(timer);
            },
          },
          logger: undefined,
          baseHeaders: () => Promise.resolve(new Headers()),
          getToken: () => Promise.resolve('token'),
          refreshAuth: () => Promise.resolve(true),
        },
        fetchUnreadCount: () => Promise.resolve(8),
      },
      {
        transport,
        syncCount: true,
        reconnectOnVisible: false,
        reconnectOnOnline: false,
      },
    );
    const origins: NotificationUpdateOrigin[] = [];
    let raw: EventTransportFrame | undefined;

    stream.onUpdate(NotificationUpdateType.UnreadCount, (context) => {
      origins.push(context.origin);
      raw = context.raw;
    });

    await stream.connect();
    await stream.drain();

    expect(origins).toEqual([NotificationUpdateOrigin.Sync]);
    expect(raw).toBeUndefined();
    stream.disconnect();
  });
});
