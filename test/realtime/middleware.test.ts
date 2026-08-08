import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import {
  RealtimeComposer,
  type RealtimeContext,
  type RealtimeMiddlewareObj,
  type RealtimeUnknownUpdate,
  RealtimeUpdateType,
} from '../../src/index.js';
import { MAX_PENDING_UPDATES } from '../../src/realtime/middleware.js';
import { makeStream, notification, TestTransport, unreadCount } from './helpers.js';

describe('realtime middleware', () => {
  it('подключает RealtimeComposer к stream как единый feature-модуль', async () => {
    const transport = new TestTransport();
    const stream = makeStream(transport);
    const feature = new RealtimeComposer<RealtimeContext>();
    const seen: string[] = [];
    feature
      .filter((context) => context.update.type === RealtimeUpdateType.Notification)
      .use(async (context, next) => {
        if (context.update.type === RealtimeUpdateType.Notification) {
          seen.push(context.update.data.notification.id);
        }
        await next();
      });

    const removeFeature = stream.use(feature);
    await stream.connect();
    transport.emit(notification('n1'));
    await stream.drain();
    removeFeature();
    transport.emit(notification('n2'));
    await stream.drain();

    expect(seen).toEqual(['n1']);
    stream.disconnect();
  });

  it('снимает объектный middleware при получении каждого update', async () => {
    const transport = new TestTransport();
    const stream = makeStream(transport);
    const captured: string[] = [];
    const seen: string[] = [];
    let version = 'first';
    const feature: RealtimeMiddlewareObj = {
      middleware() {
        const snapshot = version;
        captured.push(snapshot);
        return async (_context, next) => {
          seen.push(snapshot);
          await next();
        };
      },
    };

    stream.use(feature);
    expect(captured).toEqual([]);

    await stream.connect();
    transport.emit(notification('n1'));
    version = 'second';
    transport.emit(notification('n2'));
    await stream.drain();

    expect(captured).toEqual(['first', 'second']);
    expect(seen).toEqual(['first', 'second']);
    stream.disconnect();
  });

  it('выполняет onion-цепочку в порядке регистрации', async () => {
    const transport = new TestTransport();
    const stream = makeStream(transport);
    const order: string[] = [];

    stream.use(async (_context, next) => {
      order.push('outer:before');
      await next();
      order.push('outer:after');
    });
    stream.use(async (_context, next) => {
      order.push('inner:before');
      await next();
      order.push('inner:after');
    });
    stream.onUpdate('notification', () => order.push('handler'));
    stream.on('notification', () => order.push('listener'));

    await stream.connect();
    transport.emit(notification('n1'));
    await stream.drain();

    expect(order).toEqual([
      'outer:before',
      'inner:before',
      'handler',
      'listener',
      'inner:after',
      'outer:after',
    ]);
    stream.disconnect();
  });

  it('останавливает update, если middleware не вызвал next', async () => {
    const transport = new TestTransport();
    const stream = makeStream(transport);
    const handler = vi.fn();
    const listener = vi.fn();

    stream.use(() => {});
    stream.onUpdate('notification', handler);
    stream.on('notification', listener);

    await stream.connect();
    transport.emit(notification('n1'));
    await stream.drain();

    expect(handler).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
    stream.disconnect();
  });

  it('использует snapshot middleware на момент получения update', async () => {
    const transport = new TestTransport();
    const stream = makeStream(transport);
    const seen: string[] = [];
    let release: (() => void) | undefined;
    let first = true;

    stream.use(async (_context, next) => {
      if (first) {
        first = false;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      await next();
    });
    const off = stream.use(async (_context, next) => {
      seen.push('registered');
      await next();
    });

    await stream.connect();
    transport.emit(notification('n1'));
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    off();
    release?.();
    await stream.drain();

    transport.emit(notification('n2'));
    await stream.drain();

    expect(seen).toEqual(['registered']);
    stream.disconnect();
  });

  it('изолирует middleware error и продолжает принимать updates', async () => {
    const transport = new TestTransport();
    const stream = makeStream(transport);
    const errors: unknown[] = [];
    const delivered: string[] = [];
    let fail = true;

    stream.on('middlewareError', ({ error }) => errors.push(error));
    stream.use(async (_context, next) => {
      if (fail) {
        fail = false;
        throw new Error('сломано');
      }
      await next();
    });
    stream.onUpdate('notification', ({ update }) => delivered.push(update.data.notification.id));

    await stream.connect();
    transport.emit(notification('n1'));
    transport.emit(notification('n2'));
    await stream.drain();

    expect(errors).toHaveLength(1);
    expect(delivered).toEqual(['n2']);
    stream.disconnect();
  });

  it('сообщает о повторном next и не доставляет update дважды', async () => {
    const transport = new TestTransport();
    const stream = makeStream(transport);
    const errors: unknown[] = [];
    const delivered = vi.fn();

    stream.on('middlewareError', ({ error }) => errors.push(error));
    stream.use(async (_context, next) => {
      await next();
      await next();
    });
    stream.on('notification', delivered);

    await stream.connect();
    transport.emit(notification('n1'));
    await stream.drain();

    expect(errors).toHaveLength(1);
    expect(delivered).toHaveBeenCalledOnce();
    stream.disconnect();
  });

  it('учитывает downstream даже если middleware не вернул promise next()', async () => {
    const transport = new TestTransport();
    const stream = makeStream(transport);
    let release: (() => void) | undefined;

    stream.use((_context, next) => {
      void next();
    });
    stream.onUpdate(
      'notification',
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );

    await stream.connect();
    transport.emit(notification('n1'));
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));

    let drained = false;
    const draining = stream.drain().then(() => {
      drained = true;
    });
    await Promise.resolve();
    expect(drained).toBe(false);

    release?.();
    await draining;
    stream.disconnect();
  });
});

describe('realtime handlers и filters', () => {
  it('сохраняет флейвор контекста после сужения update', async () => {
    type SessionContext = RealtimeContext & { session: { id: string } };

    const transport = new TestTransport();
    const stream = makeStream<SessionContext>(transport);
    const sessions: string[] = [];

    stream.use(async (context, next) => {
      context.session = { id: 'session-1' };
      await next();
    });
    stream.onUpdate(RealtimeUpdateType.Notification, (context) => {
      expectTypeOf(context.session.id).toEqualTypeOf<string>();
      expectTypeOf(context.update.type).toEqualTypeOf<'notification'>();
      sessions.push(context.session.id);
    });
    stream.onNotification('post_comment', (context) => {
      expectTypeOf(context.session.id).toEqualTypeOf<string>();
      expectTypeOf(context.update.data.notification.type).toEqualTypeOf<'post_comment'>();
    });

    await stream.connect();
    transport.emit(notification('n1'));
    await stream.drain();

    expect(sessions).toEqual(['session-1']);
    stream.disconnect();
  });

  it('сужает тип update и тип уведомления', () => {
    const stream = makeStream(new TestTransport());

    stream.onUpdate((context) => {
      expectTypeOf(context.update).toEqualTypeOf<RealtimeContext['update']>();
    });
    stream.onUpdate('unreadCount', (context) => {
      expectTypeOf(context.update.type).toEqualTypeOf<'unreadCount'>();
      expectTypeOf(context.update.data).toEqualTypeOf<number>();
    });
    stream.onNotification(['post_comment', 'comment_reply'] as const, (context) => {
      expectTypeOf(context.update.data.notification.type).toEqualTypeOf<
        'post_comment' | 'comment_reply'
      >();
    });
    stream.onNotification({ type: ['post_comment', 'comment_reply'] }, (context) => {
      expectTypeOf(context.update.data.notification.type).toEqualTypeOf<
        'post_comment' | 'comment_reply'
      >();
    });

    type StructuredUnknown = RealtimeContext<RealtimeUnknownUpdate & { data: { postId: string } }>;
    const isStructuredUnknown = (context: RealtimeContext): context is StructuredUnknown =>
      context.update.type === RealtimeUpdateType.Unknown &&
      typeof context.update.data === 'object' &&
      context.update.data !== null &&
      'postId' in context.update.data;

    stream.onUpdate(isStructuredUnknown, (context) => {
      expectTypeOf(context.update.data.postId).toEqualTypeOf<string>();
    });
  });

  it('фильтрует уведомления по типу, actor и объектам', async () => {
    const transport = new TestTransport();
    const stream = makeStream(transport);
    const seen: string[] = [];

    stream.onNotification(
      {
        type: 'post_comment',
        actorId: 'actor-1',
        entityId: 'comment-n1',
        parentEntityId: 'post-n1',
      },
      ({ update }) => seen.push(update.data.notification.id),
    );

    await stream.connect();
    transport.emit(notification('n1'));
    transport.emit(notification('n2', 'like'));
    transport.emit(notification('n3', 'comment', 'actor-2'));
    await stream.drain();

    expect(seen).toEqual(['n1']);
    stream.disconnect();
  });

  it('изолирует ошибки async handlers и продолжает остальные обработчики', async () => {
    const transport = new TestTransport();
    const stream = makeStream(transport);
    const errors: unknown[] = [];
    const seen: string[] = [];

    stream.on('handlerError', ({ error }) => errors.push(error));
    stream.onUpdate('notification', async () => {
      throw new Error('handler failed');
    });
    stream.onUpdate('notification', ({ update }) => seen.push(update.data.notification.id));

    await stream.connect();
    transport.emit(notification('n1'));
    await stream.drain();

    expect(errors).toHaveLength(1);
    expect(seen).toEqual(['n1']);
    stream.disconnect();
  });
});

describe('realtime dispatch', () => {
  it('по умолчанию обрабатывает updates последовательно', async () => {
    const transport = new TestTransport();
    const stream = makeStream(transport);
    const started: string[] = [];
    let release: (() => void) | undefined;

    stream.onUpdate('notification', async ({ update }) => {
      const id = update.data.notification.id;
      started.push(id);
      if (id === 'n1') {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
    });

    await stream.connect();
    transport.emit(notification('n1'));
    transport.emit(notification('n2'));
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    expect(started).toEqual(['n1']);

    release?.();
    await stream.drain();
    expect(started).toEqual(['n1', 'n2']);
    stream.disconnect();
  });

  it('сочетает concurrency с последовательностью по ключу', async () => {
    const transport = new TestTransport();
    const stream = makeStream(transport, {
      concurrency: 2,
      sequentialize: (context) =>
        context.update.type === 'notification'
          ? context.update.data.notification.actors[0]?.id
          : undefined,
    });
    const started: string[] = [];
    let release: (() => void) | undefined;

    stream.onUpdate('notification', async ({ update }) => {
      const id = update.data.notification.id;
      started.push(id);
      if (id === 'n1') {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
    });

    await stream.connect();
    transport.emit(notification('n1', 'comment', 'actor-1'));
    transport.emit(notification('n2', 'comment', 'actor-1'));
    transport.emit(notification('n3', 'comment', 'actor-2'));
    await vi.waitFor(() => expect(started).toHaveLength(2));

    expect(started).toEqual(['n1', 'n3']);
    release?.();
    await stream.drain();
    expect(started).toEqual(['n1', 'n3', 'n2']);
    stream.disconnect();
  });

  it('не пропускает более поздний update вперёд по общему ключу', async () => {
    const transport = new TestTransport();
    const stream = makeStream(transport, {
      concurrency: 2,
      sequentialize: ({ update }) =>
        update.type === RealtimeUpdateType.Unknown
          ? (update.data as { keys: readonly string[] }).keys
          : undefined,
    });
    const started: string[] = [];
    const releases = new Map<string, () => void>();

    stream.onUpdate(RealtimeUpdateType.Unknown, async ({ update }) => {
      started.push(update.name);
      if (update.name === 'first' || update.name === 'multi') {
        await new Promise<void>((resolve) => releases.set(update.name, resolve));
      }
    });

    await stream.connect();
    transport.emit({ name: 'first', data: { keys: ['a'] } });
    transport.emit({ name: 'multi', data: { keys: ['a', 'b'] } });
    transport.emit({ name: 'later', data: { keys: ['b'] } });
    transport.emit({ name: 'independent', data: { keys: ['c'] } });
    await vi.waitFor(() => expect(started).toEqual(['first', 'independent']));

    releases.get('first')?.();
    await vi.waitFor(() => expect(started).toEqual(['first', 'independent', 'multi']));

    releases.get('multi')?.();
    await stream.drain();
    expect(started).toEqual(['first', 'independent', 'multi', 'later']);
    stream.disconnect();
  });

  it('схлопывает ожидающие счётчики, но не уведомления', async () => {
    const transport = new TestTransport();
    const stream = makeStream(transport);
    const counts: number[] = [];
    const seen: string[] = [];
    let release: (() => void) | undefined;

    stream.onUpdate(RealtimeUpdateType.Notification, async ({ update }) => {
      seen.push(update.data.notification.id);
      if (seen.length > 1) return;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    stream.onUpdate(RealtimeUpdateType.UnreadCount, ({ update }) => {
      counts.push(update.data);
    });

    await stream.connect();
    transport.emit(notification('n1'));
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));

    transport.emit(unreadCount(1));
    transport.emit(notification('n2'));
    transport.emit(unreadCount(2));
    transport.emit(unreadCount(3));

    release?.();
    await stream.drain();

    expect(counts).toEqual([3]);
    expect(seen).toEqual(['n1', 'n2']);
    stream.disconnect();
  });

  it('не принимает обновления сверх предела очереди', async () => {
    const transport = new TestTransport();
    const stream = makeStream(transport);
    const seen: string[] = [];
    let release: (() => void) | undefined;

    stream.on('error', () => {});
    stream.onUpdate(RealtimeUpdateType.Notification, async ({ update }) => {
      seen.push(update.data.notification.id);
      if (seen.length > 1) return;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    });

    await stream.connect();
    for (let index = 0; index <= MAX_PENDING_UPDATES + 1; index += 1) {
      transport.emit(notification(`n${index}`));
    }
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));

    release?.();
    await stream.drain();

    // Один активный плюс полная очередь: последнее обновление не принято.
    expect(seen).toHaveLength(MAX_PENDING_UPDATES + 1);
    expect(seen).not.toContain(`n${MAX_PENDING_UPDATES + 1}`);
    stream.disconnect();
  });

  it('disconnect отбрасывает очередь, а drain ждёт активный handler', async () => {
    const transport = new TestTransport();
    const stream = makeStream(transport);
    const started: string[] = [];
    let release: (() => void) | undefined;

    stream.onUpdate('notification', async ({ update }) => {
      started.push(update.data.notification.id);
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    });

    await stream.connect();
    transport.emit(notification('n1'));
    transport.emit(notification('n2'));
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));

    stream.disconnect();
    let drained = false;
    const draining = stream.drain().then(() => {
      drained = true;
    });
    await Promise.resolve();
    expect(drained).toBe(false);

    release?.();
    await draining;
    expect(started).toEqual(['n1']);
  });
});
