import { crypt } from '@itd-api/crypto';
import { createMockServer, notificationFixture } from '@itd-api/testing';
import {
  EventRouter,
  type EventTransportFrame,
  ItdClient,
  NotificationEvents,
  NotificationType,
  NotificationUpdateType,
} from 'itd-api';
import { describe, expect, it } from 'vitest';
import {
  type HydratedEventContext,
  type HydratedNotificationEvent,
  hydrateClient,
} from '../src/index.js';

const seed = {
  users: [
    { id: 'user-alice', username: 'alice', displayName: 'Алиса' },
    { id: 'user-bob', username: 'bob', displayName: 'Боб' },
  ],
  posts: [{ id: 'post-1', authorId: 'user-bob', content: 'Запись Боба' }],
  comments: [
    {
      id: 'comment-1',
      postId: 'post-1',
      authorId: 'user-alice',
      content: 'Комментарий Алисы',
    },
  ],
} as const;

async function realtimeClient() {
  const server = createMockServer({ seed });
  const transport = server.notificationEvents({ as: 'bob' });
  const raw = new ItdClient({
    ...server.clientOptions({ as: 'bob' }),
    events: { notifications: { transport, syncCount: false } },
  });
  raw.use(crypt());
  const itd = hydrateClient(raw);
  const stream = itd.notifications.events;
  await stream.connect();
  await transport.waitForConnection();
  return { server, transport, raw, itd, stream };
}

function commentNotification() {
  return notificationFixture({
    id: 'notification-comment',
    type: NotificationType.PostComment,
    rawType: NotificationType.PostComment,
    entityId: 'comment-1',
    parentEntityId: 'post-1',
    actors: [
      {
        id: 'user-alice',
        username: 'alice',
        displayName: 'Алиса',
        avatar: '🦎',
      },
    ],
  });
}

describe('гидратация realtime', () => {
  it('передаёт один гидратированный объект всем обработчикам', async () => {
    const server = createMockServer({ seed });
    const transport = server.notificationEvents({ as: 'bob' });
    const itd = hydrateClient(
      new ItdClient({
        ...server.clientOptions({ as: 'bob' }),
        events: { notifications: { transport, syncCount: false } },
      }),
    );
    const stream = itd.notifications.events;
    expect(stream).toBeInstanceOf(NotificationEvents);

    const contexts: unknown[] = [];
    const events: HydratedNotificationEvent[] = [];
    const messages: EventTransportFrame[] = [];

    stream.use(async (context, next) => {
      contexts.push(context);
      expect(typeof context.update.type === 'string').toBe(true);
      await next();
    });
    stream.onUpdate(NotificationUpdateType.Notification, (context) => contexts.push(context));
    stream.onNotification(NotificationType.PostComment, (context) => contexts.push(context));
    stream.on('notification', (event) => events.push(event));
    stream.once('notification', (event) => events.push(event));
    stream.on('message', (message) => messages.push(message));

    const router = new EventRouter((context: HydratedEventContext) => context.update.type);
    router.route(NotificationUpdateType.Notification, async (context, next) => {
      contexts.push(context);
      if (context.update.type === NotificationUpdateType.Notification) {
        expect(typeof context.update.data.notification.actors[0]?.get).toBe('function');
      }
      await next();
    });
    stream.use(router);

    await stream.connect();
    await transport.waitForConnection();
    const payload = { payload: commentNotification(), unreadCount: 1 };
    transport.message('notification', payload);
    await stream.drain();

    expect(contexts).toHaveLength(4);
    expect(new Set(contexts).size).toBe(1);
    expect(events).toHaveLength(2);
    expect(events[0]).toBe(events[1]);
    const context = contexts[0] as {
      update: { data: HydratedNotificationEvent };
      stream: unknown;
    };
    expect(context.update.data).toBe(events[0]);
    expect(context.stream).toBe(stream);
    expect(messages[0]?.data).toBe(payload);
    expect('getPost' in payload.payload).toBe(false);

    stream.disconnect();
  });

  it('загружает пост и выполняет действия над комментарием через исходный клиент', async () => {
    const { server, transport, stream } = await realtimeClient();
    let event: HydratedNotificationEvent | undefined;
    stream.on('notification', (value) => {
      event = value;
    });

    transport.notification(commentNotification());
    await stream.drain();

    const notification = event?.notification;
    expect(notification).toBeDefined();
    const post = await notification?.getPost();
    expect(post?.id).toBe('post-1');
    expect(typeof post?.like).toBe('function');

    const reply = await notification?.comment?.reply(
      (builder) => builder.content('Секретный ответ').replyTo('user-alice'),
      {
        extensions: {
          crypto: { encrypt: { cipher: 'invisible', cover: 'Обычный ответ' } },
        },
      },
    );
    expect(reply?.secret?.text).toBe('Секретный ответ');
    expect(typeof reply?.getReplies).toBe('function');
    expect(
      server
        .snapshot()
        .comments.some(
          (comment) =>
            comment.parentCommentId === 'comment-1' && comment.content !== 'Секретный ответ',
        ),
    ).toBe(true);

    await notification?.actors[0]?.follow();
    expect(server.snapshot().users.find((user) => user.id === 'user-bob')?.following).toContain(
      'user-alice',
    );
    server.assertNoUnsupportedRequests();
    stream.disconnect();
  });

  it('выбирает идентификатор поста по типу уведомления', async () => {
    const { transport, stream } = await realtimeClient();
    const events: HydratedNotificationEvent[] = [];
    stream.on('notification', (event) => events.push(event));

    transport.notification(
      notificationFixture({
        type: NotificationType.PostReaction,
        rawType: NotificationType.PostReaction,
        entityId: 'post-1',
      }),
    );
    transport.notification(
      notificationFixture({
        id: 'follow',
        type: NotificationType.Follow,
        rawType: NotificationType.Follow,
        entityId: 'user-alice',
      }),
    );
    await stream.drain();

    expect((await events[0]?.notification.getPost())?.id).toBe('post-1');
    expect(events[0]?.notification.comment).toBeUndefined();
    expect(await events[1]?.notification.getPost()).toBeUndefined();
    expect(events[1]?.notification.comment).toBeUndefined();
    stream.disconnect();
  });
});
