import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import {
  EventChannel,
  type EventChannelDeps,
  type EventChannelEvents,
  type EventChannelOptions,
} from '../../src/events/engine.js';
import { MAX_PENDING_UPDATES } from '../../src/events/middleware.js';
import { EventRouter } from '../../src/events/router.js';
import {
  type EventTransport,
  type EventTransportContext,
  type EventTransportFrame,
  UnauthorizedStreamError,
} from '../../src/events/transports/transport.js';
import type { EventContext } from '../../src/events/updates.js';

interface TestUpdate {
  readonly value: number;
}

interface TestStream {
  readonly name: 'test-stream';
}

interface TestContext extends EventContext<TestUpdate, TestStream, 'stream' | 'sync'> {
  traceId: string;
}

interface TestEvents extends EventChannelEvents<TestContext> {
  domain: number;
}

const owner: TestStream = { name: 'test-stream' };

class TestTransport implements EventTransport {
  readonly name = 'engine-test';
  readonly contexts: EventTransportContext[] = [];
  connects = 0;
  #context: EventTransportContext | undefined;
  readonly #autoOpen: boolean;

  constructor(autoOpen = true) {
    this.#autoOpen = autoOpen;
  }

  connect(context: EventTransportContext): Promise<void> {
    this.connects += 1;
    this.contexts.push(context);
    this.#context = context;
    if (this.#autoOpen) context.onOpen();
    return new Promise<void>((resolve) => {
      context.signal.addEventListener('abort', () => resolve(), { once: true });
    });
  }

  emit(event: EventTransportFrame): void {
    this.#context?.onEvent(event);
  }

  emitFrom(connection: number, event: EventTransportFrame): void {
    this.contexts[connection]?.onEvent(event);
  }

  open(connection = this.contexts.length - 1): void {
    this.contexts[connection]?.onOpen();
  }
}

function makeEngine(
  transport: EventTransport,
  deps: Partial<EventChannelDeps<TestUpdate, TestContext, TestContext['origin']>> = {},
  options: EventChannelOptions<TestContext> = {},
): EventChannel<TestUpdate, TestContext, TestEvents, TestContext['origin']> {
  return new EventChannel<TestUpdate, TestContext, TestEvents, TestContext['origin']>(
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
      transport,
      streamOrigin: 'stream',
      readUpdate: (event) =>
        event.name === 'value' && typeof event.data === 'number'
          ? { value: event.data }
          : undefined,
      createContext: (update, raw, origin) => ({
        update,
        stream: owner,
        raw,
        origin,
        traceId: '',
      }),
      deliver: () => {},
      ...deps,
    },
    { reconnectOnOnline: false, reconnectOnVisible: false, ...options },
  );
}

interface DomainContext extends EventContext<TestUpdate, TestStream, 'ws' | 'catchup'> {
  traceId: string;
}

describe('event channel', () => {
  it('проверяет общие настройки самостоятельно', () => {
    const transport = new TestTransport();
    const create = () => makeEngine(transport, {}, { concurrency: 0 });

    expect(create).toThrow(/concurrency должен быть больше нуля/);
  });

  it('обрабатывает произвольный домен и владеет общей картой событий', async () => {
    const transport = new TestTransport();
    const delivered: number[] = [];
    const messages: string[] = [];
    const domainEvents: number[] = [];

    const engine = makeEngine(transport, {
      deliver: (update) => delivered.push(update.value),
    });

    engine.use(async (context, next) => {
      expectTypeOf(context.stream).toEqualTypeOf<TestStream>();
      context.traceId = `update-${context.update.value}`;
      await next();
    });
    const router = new EventRouter<'value', TestContext>(() => 'value');
    router.route('value', async (context, next) => {
      expectTypeOf(context.update).toEqualTypeOf<TestUpdate>();
      await next();
    });
    engine.use(router);
    engine.onUpdate(
      () => true,
      (context) => {
        expect(context.traceId).toBe(`update-${context.update.value}`);
      },
    );
    engine.on('message', (event) => messages.push(event.name));
    engine.on('domain', (value) => domainEvents.push(value));

    await engine.connect();
    engine.emit('domain', 7);
    transport.emit({ name: 'value', data: 3 });
    await engine.drain();

    expect(engine.status).toBe('connected');
    expect(engine.transport).toBe('engine-test');
    expect(messages).toEqual(['value']);
    expect(domainEvents).toEqual([7]);
    expect(delivered).toEqual([3]);

    engine.disconnect();
  });

  it('не доставляет результат синхронизации после disconnect()', async () => {
    const transport = new TestTransport();
    const delivered: number[] = [];
    let release: (() => void) | undefined;
    const engine = makeEngine(transport, {
      deliver: (update) => delivered.push(update.value),
      initialize: async (_reason, session) => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        session.enqueue({ value: 1 }, { origin: 'sync' });
      },
    });

    const connecting = engine.connect();
    engine.disconnect();
    release?.();
    await connecting;
    await engine.drain();

    expect(delivered).toEqual([]);
  });

  it('не смешивает поколения при быстром disconnect/connect', async () => {
    const transport = new TestTransport();
    const delivered: number[] = [];
    const releases: Array<() => void> = [];
    let syncSequence = 0;

    const engine = makeEngine(transport, {
      deliver: (update) => delivered.push(update.value),
      initialize: (_reason, session) => {
        const value = ++syncSequence;
        return new Promise<void>((resolve) => {
          releases.push(() => {
            session.enqueue({ value }, { origin: 'sync' });
            resolve();
          });
        });
      },
    });

    const first = engine.connect();
    engine.disconnect();
    const second = engine.connect();

    releases[0]?.();
    await first;
    await engine.drain();
    expect(transport.connects).toBe(0);
    expect(delivered).toEqual([]);

    releases[1]?.();
    await second;
    await engine.drain();
    expect(transport.connects).toBe(1);
    expect(delivered).toEqual([2]);

    engine.disconnect();
  });

  it('drain() после disconnect ждёт освобождения ресурсов подготовки и транспорта', async () => {
    let releaseInitializerCleanup: (() => void) | undefined;
    let releaseTransportCleanup: (() => void) | undefined;
    let initializerStarted = false;
    let transportStarted = false;
    let initializerCleaned = false;
    let transportCleaned = false;

    const transport: EventTransport = {
      name: 'cleanup-test',
      connect: async (context) => {
        transportStarted = true;
        context.onOpen();
        await new Promise<void>((resolve) => {
          context.signal.addEventListener(
            'abort',
            () => {
              releaseTransportCleanup = resolve;
            },
            { once: true },
          );
        });
        transportCleaned = true;
      },
    };
    const engine = makeEngine(transport, {
      openBeforeInitialize: true,
      initialize: async (_reason, session) => {
        initializerStarted = true;
        await new Promise<void>((resolve) => {
          session.signal.addEventListener(
            'abort',
            () => {
              releaseInitializerCleanup = resolve;
            },
            { once: true },
          );
        });
        initializerCleaned = true;
      },
    });

    const connecting = engine.connect();
    await vi.waitFor(() => {
      expect(transportStarted).toBe(true);
      expect(initializerStarted).toBe(true);
    });

    engine.disconnect();
    let drained = false;
    const draining = engine.drain().then(() => {
      drained = true;
    });
    await Promise.resolve();
    expect(drained).toBe(false);

    releaseInitializerCleanup?.();
    await connecting;
    await Promise.resolve();
    expect(initializerCleaned).toBe(true);
    expect(drained).toBe(false);

    releaseTransportCleanup?.();
    await draining;
    expect(transportCleaned).toBe(true);
    expect(drained).toBe(true);
  });

  it('drain() после disconnect ждёт уже начатое обновление авторизации', async () => {
    let refreshStarted = false;
    let releaseRefresh: (() => void) | undefined;
    const transport: EventTransport = {
      name: 'unauthorized-test',
      connect: async (context) => {
        context.onOpen();
        throw new UnauthorizedStreamError();
      },
    };
    const engine = makeEngine(transport, {
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
        refreshAuth: async () => {
          refreshStarted = true;
          await new Promise<void>((resolve) => {
            releaseRefresh = resolve;
          });
          return true;
        },
      },
    });

    await engine.connect();
    await vi.waitFor(() => expect(refreshStarted).toBe(true));
    engine.disconnect();

    let drained = false;
    const draining = engine.drain().then(() => {
      drained = true;
    });
    await Promise.resolve();
    expect(drained).toBe(false);

    releaseRefresh?.();
    await draining;
    expect(drained).toBe(true);
  });

  it('открывает transport до initializer и выпускает buffered frames после ready', async () => {
    const transport = new TestTransport(false);
    const delivered: Array<{ value: number; origin: string }> = [];
    let initializerEntered = false;
    let releaseInitializer: (() => void) | undefined;
    const engine = makeEngine(transport, {
      openBeforeInitialize: true,
      initialize: async (_reason, session) => {
        initializerEntered = true;
        await session.opened;
        session.enqueue({ value: 1 }, { origin: 'sync' });
        await new Promise<void>((resolve) => {
          releaseInitializer = resolve;
        });
      },
      deliver: () => {},
    });
    engine.onUpdate(
      () => true,
      ({ update, origin }) => delivered.push({ value: update.value, origin }),
    );

    const connecting = engine.connect();
    await Promise.resolve();
    expect(initializerEntered).toBe(false);

    transport.open();
    await vi.waitFor(() => expect(initializerEntered).toBe(true));
    transport.emit({ name: 'value', data: 2 });
    await engine.drain();
    expect(delivered).toEqual([{ value: 1, origin: 'sync' }]);

    releaseInitializer?.();
    await connecting;
    await engine.drain();
    expect(delivered).toEqual([
      { value: 1, origin: 'sync' },
      { value: 2, origin: 'stream' },
    ]);
    engine.disconnect();
  });

  it('ограничивает кадры, ожидающие открытия ready-gate', async () => {
    const transport = new TestTransport(false);
    let initializerStarted = false;
    const engine = makeEngine(
      transport,
      {
        openBeforeInitialize: true,
        initialize: async (_reason, session) => {
          await session.opened;
          initializerStarted = true;
          await new Promise<void>((resolve) => {
            if (session.signal.aborted) {
              resolve();
              return;
            }
            session.signal.addEventListener('abort', () => resolve(), { once: true });
          });
        },
      },
      { maxAttempts: 0 },
    );
    engine.on('error', () => {});
    const connecting = engine.connect();
    transport.open();
    await vi.waitFor(() => expect(initializerStarted).toBe(true));

    for (let value = 0; value <= MAX_PENDING_UPDATES; value += 1) {
      transport.emit({ name: 'value', data: value });
    }

    await vi.waitFor(() => expect(transport.contexts[0]?.signal.aborted).toBe(true));
    await connecting;
    expect(engine.status).toBe('error');
    engine.disconnect();
  });

  it('отклоняет обязательный initial barrier и инвалидирует его session', async () => {
    const transport = new TestTransport();
    const delivered: number[] = [];
    let signal: AbortSignal | undefined;
    const failure = new Error('snapshot failed');
    const engine = makeEngine(transport, {
      openBeforeInitialize: true,
      initializationRequired: true,
      initialize: async (_reason, session) => {
        signal = session.signal;
        transport.emit({ name: 'value', data: 1 });
        throw failure;
      },
      deliver: (update) => delivered.push(update.value),
    });

    await expect(engine.connect()).rejects.toBe(failure);
    await engine.drain();
    expect(signal?.aborted).toBe(true);
    expect(transport.contexts[0]?.signal.aborted).toBe(true);
    expect(delivered).toEqual([]);
    expect(engine.status).toBe('disconnected');
  });

  it('generic channel сохраняет собственные origins домена', async () => {
    const transport = new TestTransport();
    const origins: Array<DomainContext['origin']> = [];
    const engine = new EventChannel<
      TestUpdate,
      DomainContext,
      EventChannelEvents<DomainContext>,
      DomainContext['origin']
    >(
      {
        connection: {
          baseUrl: 'https://chat.test',
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
        transport,
        streamOrigin: 'ws',
        initialize: async (_reason, session) => {
          session.enqueue({ value: 1 }, { origin: 'catchup' });
        },
        readUpdate: (event) =>
          event.name === 'value' && typeof event.data === 'number'
            ? { value: event.data }
            : undefined,
        createContext: (update, raw, origin) => ({
          update,
          stream: owner,
          raw,
          origin,
          traceId: '',
        }),
        deliver: () => {},
      },
      { reconnectOnOnline: false, reconnectOnVisible: false },
    );
    engine.onUpdate(
      () => true,
      ({ origin }) => origins.push(origin),
    );

    await engine.connect();
    transport.emit({ name: 'value', data: 2 });
    await engine.drain();

    expect(origins).toEqual(['catchup', 'ws']);
    engine.disconnect();
  });

  it('переполнение очереди рвёт соединение и переподключается с догоном', async () => {
    const transport = new TestTransport();
    const delivered: number[] = [];
    const syncReasons: string[] = [];
    let release: (() => void) | undefined;
    let blocked = false;

    const engine = makeEngine(
      transport,
      {
        deliver: (update) => delivered.push(update.value),
        initialize: (reason) => {
          syncReasons.push(reason);
          return Promise.resolve();
        },
      },
      { backoff: [0], jitter: 0 },
    );
    engine.on('error', () => {});
    engine.onUpdate(
      () => true,
      async () => {
        if (blocked) return;
        blocked = true;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      },
    );

    await engine.connect();
    for (let value = 0; value <= MAX_PENDING_UPDATES + 1; value += 1) {
      transport.emit({ name: 'value', data: value });
    }
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));

    // Приём кадров прекращён: единственный способ создать backpressure в потоке.
    expect(transport.contexts[0]?.signal.aborted).toBe(true);

    release?.();
    await engine.drain();
    await vi.waitFor(() => expect(transport.connects).toBe(2));

    expect(syncReasons).toEqual(['initial', 'reconnect']);
    expect(delivered).toHaveLength(MAX_PENDING_UPDATES + 1);
    expect(delivered).not.toContain(MAX_PENDING_UPDATES + 1);

    engine.disconnect();
  });

  it('игнорирует события транспорта из закрытого поколения', async () => {
    const transport = new TestTransport();
    const delivered: number[] = [];
    const engine = makeEngine(transport, {
      deliver: (update) => delivered.push(update.value),
    });

    await engine.connect();
    engine.disconnect();
    await engine.connect();

    transport.emitFrom(0, { name: 'value', data: 1 });
    transport.emit({ name: 'value', data: 2 });
    await engine.drain();

    expect(delivered).toEqual([2]);
    engine.disconnect();
  });
});
