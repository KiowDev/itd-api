import { crypt, encodeInvisible } from '@itd-api/crypto';
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
} from '../../src/index.js';

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

async function eventsClient() {
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

describe('гидратация событий', () => {
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
    const { server, transport, stream } = await eventsClient();
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
          crypto: { encrypt: 'invisible' },
        },
      },
    );
    expect(reply?.decoded?.content?.text).toBe('Секретный ответ');
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

  it('гидратирует уведомление заново, если middleware заменил его копией', async () => {
    const server = createMockServer({ seed });
    const transport = server.notificationEvents({ as: 'bob' });
    const itd = hydrateClient(
      new ItdClient({
        ...server.clientOptions({ as: 'bob' }),
        events: { notifications: { transport, syncCount: false } },
      }),
    );
    const stream = itd.notifications.events;
    stream.use(crypt());

    const handled: HydratedNotificationEvent['notification'][] = [];
    const events: HydratedNotificationEvent[] = [];
    stream.onNotification(
      {
        type: NotificationType.PostComment,
        predicate: ({ update }) => typeof update.data.notification.getPost === 'function',
      },
      ({ update }) => {
        handled.push(update.data.notification);
      },
    );
    stream.on('notification', (event) => events.push(event));

    await stream.connect();
    await transport.waitForConnection();
    transport.notification({ ...commentNotification(), preview: encodeInvisible('Секрет') });
    await stream.drain();

    const notification = handled[0];
    expect(notification?.decoded?.preview?.text).toBe('Секрет');
    expect(typeof notification?.getPost).toBe('function');
    expect(notification?.comment?.id).toBe('comment-1');
    expect(events[0]?.notification).toBe(notification);
    stream.disconnect();
  });

  it('сохраняет маршруты, действовавшие при постановке события в очередь', async () => {
    const { transport, stream } = await eventsClient();
    const routed: string[] = [];
    let releaseFirst: () => void = () => undefined;
    let firstStarted: () => void = () => undefined;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const firstEntered = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });

    const router = new EventRouter((context: HydratedEventContext) => context.update.type);
    stream.use(router);
    stream.onNotification(NotificationType.PostComment, async ({ update }) => {
      if (update.data.notification.id === 'first') {
        firstStarted();
        await firstBlocked;
      }
    });

    transport.notification({ ...commentNotification(), id: 'first' });
    await firstEntered;
    transport.notification({ ...commentNotification(), id: 'second' });
    router.route(NotificationUpdateType.Notification, async ({ update }, next) => {
      if (update.type === NotificationUpdateType.Notification) {
        routed.push(update.data.notification.id);
      }
      await next();
    });
    releaseFirst();
    await stream.drain();
    transport.notification({ ...commentNotification(), id: 'third' });
    await stream.drain();

    expect(routed).toEqual(['third']);
    stream.disconnect();
  });

  it('сохраняет действия при возврате из next() после преобразования middleware', async () => {
    const { transport, stream } = await eventsClient();
    const handled: HydratedNotificationEvent['notification'][] = [];
    const errors: unknown[] = [];
    stream.on('middlewareError', ({ error }) => errors.push(error));
    stream.use(async (context, next) => {
      await next();
      if (context.update.type === NotificationUpdateType.Notification) {
        const notification = context.update.data.notification;
        await notification.getPost();
        handled.push(notification);
      }
    });
    stream.use(crypt());

    transport.notification({ ...commentNotification(), preview: encodeInvisible('Секрет') });
    await stream.drain();

    expect(errors).toEqual([]);
    expect(handled[0]?.decoded?.preview?.text).toBe('Секрет');
    stream.disconnect();
  });

  it('выбирает идентификатор поста по типу уведомления', async () => {
    const { transport, stream } = await eventsClient();
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
