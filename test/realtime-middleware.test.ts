import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import {
  ItdClient,
  ItdRealtime,
  type RealtimeContext,
  type RealtimeDeps,
  type RealtimeMiddlewareObj,
  type RealtimeOptions,
  RealtimeRouter,
  type RealtimeTransport,
  type RealtimeUnknownUpdate,
  RealtimeUpdateOrigin,
  RealtimeUpdateType,
  type TransportContext,
  type TransportEvent,
} from '../src/index.js';

class TestTransport implements RealtimeTransport {
  readonly name = 'test';

  #context: TransportContext | undefined;

  connect(context: TransportContext): Promise<void> {
    this.#context = context;
    context.onOpen();
    return new Promise<void>((resolve) => {
      context.signal.addEventListener('abort', () => resolve(), { once: true });
    });
  }

  emit(event: TransportEvent): void {
    this.#context?.onEvent(event);
  }
}

function makeStream<C extends RealtimeContext = RealtimeContext>(
  transport: TestTransport,
  options: RealtimeOptions<C> = {},
): ItdRealtime<C> {
  const deps: RealtimeDeps = {
    baseUrl: 'https://itd.test',
    fetch: (() => Promise.reject(new Error('не должно вызываться'))) as unknown as typeof fetch,
    baseHeaders: () => Promise.resolve(new Headers()),
    getToken: () => Promise.resolve('token'),
    refresh: () => Promise.resolve(true),
    fetchUnreadCount: () => Promise.resolve(0),
  };

  return new ItdRealtime<C>(deps, {
    transport,
    syncCount: false,
    reconnectOnVisible: false,
    reconnectOnOnline: false,
    ...options,
  });
}

function notification(id: string, type = 'comment', actorId = 'actor-1'): TransportEvent {
  return {
    name: 'notification',
    data: {
      payload: {
        id,
        type,
        actor: { id: actorId },
        subjectType: 'comment',
        subjectId: `comment-${id}`,
        targetId: `post-${id}`,
      },
      unreadCount: 3,
    },
  };
}

describe('realtime updates', () => {
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

    expect(updates).toEqual([RealtimeUpdateType.Notification, RealtimeUpdateType.Unknown]);
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
    const stream = new ItdRealtime(
      {
        baseUrl: 'https://itd.test',
        fetch: globalThis.fetch,
        baseHeaders: () => Promise.resolve(new Headers()),
        getToken: () => Promise.resolve('token'),
        refresh: () => Promise.resolve(true),
        fetchUnreadCount: () => Promise.resolve(8),
      },
      {
        transport,
        syncCount: true,
        reconnectOnVisible: false,
        reconnectOnOnline: false,
      },
    );
    const origins: RealtimeUpdateOrigin[] = [];
    let raw: TransportEvent | undefined;

    stream.onUpdate(RealtimeUpdateType.UnreadCount, (context) => {
      origins.push(context.origin);
      raw = context.raw;
    });

    await stream.connect();
    await stream.drain();

    expect(origins).toEqual([RealtimeUpdateOrigin.Sync]);
    expect(raw).toBeUndefined();
    stream.disconnect();
  });
});

describe('realtime middleware', () => {
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

describe('RealtimeRouter', () => {
  it('выбирает маршрут, выполняет fallback и снимает регистрацию', async () => {
    const transport = new TestTransport();
    const stream = makeStream(transport);
    const router = new RealtimeRouter((context) => {
      if (context.update.type !== 'notification') return 'other';
      return context.update.data.notification.type;
    });
    const seen: string[] = [];

    const removeRouter = stream.use(router);
    const offComment = router.route('post_comment', async (_context, next) => {
      seen.push('comment:before');
      await next();
      seen.push('comment:after');
    });
    router.otherwise(async (_context, next) => {
      seen.push('other');
      await next();
    });
    stream.onUpdate('notification', ({ update }) =>
      seen.push(`handler:${update.data.notification.id}`),
    );

    await stream.connect();
    transport.emit(notification('n1'));
    transport.emit(notification('n2', 'like'));
    await stream.drain();

    offComment();
    transport.emit(notification('n3'));
    await stream.drain();

    expect(seen).toEqual([
      'comment:before',
      'handler:n1',
      'comment:after',
      'other',
      'handler:n2',
      'other',
      'handler:n3',
    ]);
    removeRouter();
    stream.disconnect();
  });

  it('сохраняет снимок маршрутов на момент получения update', async () => {
    const transport = new TestTransport();
    const stream = makeStream(transport);
    const router = new RealtimeRouter((context) => {
      if (context.update.type !== RealtimeUpdateType.Notification) return undefined;
      return context.update.data.notification.type;
    });
    const seen: string[] = [];
    let release: (() => void) | undefined;

    const recordRoute = (label: string) =>
      router.route('post_comment', async (context, next) => {
        if (context.update.type === RealtimeUpdateType.Notification) {
          seen.push(`${label}:${context.update.data.notification.id}`);
        }
        await next();
      });
    const recordFallback = (label: string) =>
      router.otherwise(async (context, next) => {
        if (context.update.type === RealtimeUpdateType.Notification) {
          seen.push(`${label}:${context.update.data.notification.id}`);
        }
        await next();
      });

    const removeOldRoute = recordRoute('old');
    const removeOldFallback = recordFallback('old-fallback');
    stream.use(router);
    stream.onUpdate(RealtimeUpdateType.Notification, async ({ update }) => {
      if (update.data.notification.id === 'n1') {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
    });

    await stream.connect();
    transport.emit(notification('n1'));
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));

    transport.emit(notification('n2'));
    transport.emit(notification('n4', 'like'));
    removeOldRoute();
    removeOldFallback();
    recordRoute('new');
    recordFallback('new-fallback');

    release?.();
    await stream.drain();
    transport.emit(notification('n3'));
    transport.emit(notification('n5', 'like'));
    await stream.drain();

    expect(seen).toEqual(['old:n1', 'old:n2', 'old-fallback:n4', 'new:n3', 'new-fallback:n5']);
    stream.disconnect();
  });
});

describe('ItdClient realtime lifecycle', () => {
  it('close ждёт активные realtime handlers', async () => {
    const transport = new TestTransport();
    const itd = new ItdClient({ auth: 'token', retry: false, rateLimit: false });
    const stream = itd.realtime({ transport, syncCount: false });
    let release: (() => void) | undefined;

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

    let closed = false;
    const closing = itd.close().then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);

    release?.();
    await closing;
    expect(closed).toBe(true);
  });

  it('close завершает поток после ручного disconnect и повторного connect', async () => {
    const transport = new TestTransport();
    const itd = new ItdClient({ auth: 'token', retry: false, rateLimit: false });
    const stream = itd.realtime({ transport, syncCount: false });

    await stream.connect();
    stream.disconnect();
    await stream.connect();
    expect(stream.status).toBe('connected');

    await itd.close();
    expect(stream.status).toBe('disconnected');
  });
});
