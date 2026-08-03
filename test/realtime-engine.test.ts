import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  RealtimeEngine,
  type RealtimeEngineDeps,
  type RealtimeEngineEvents,
  type RealtimeEngineOptions,
} from '../src/realtime/engine.js';
import { RealtimeRouter } from '../src/realtime/router.js';
import type {
  RealtimeTransport,
  TransportContext,
  TransportEvent,
} from '../src/realtime/transport.js';
import type { RealtimeContextBase } from '../src/realtime/updates.js';

interface TestUpdate {
  readonly value: number;
}

interface TestStream {
  readonly name: 'test-stream';
}

interface TestContext extends RealtimeContextBase<TestUpdate, TestStream> {
  traceId: string;
}

interface TestEvents extends RealtimeEngineEvents<TestContext> {
  domain: number;
}

const owner: TestStream = { name: 'test-stream' };

class TestTransport implements RealtimeTransport {
  readonly name = 'engine-test';
  readonly contexts: TransportContext[] = [];
  connects = 0;
  #context: TransportContext | undefined;

  connect(context: TransportContext): Promise<void> {
    this.connects += 1;
    this.contexts.push(context);
    this.#context = context;
    context.onOpen();
    return new Promise<void>((resolve) => {
      context.signal.addEventListener('abort', () => resolve(), { once: true });
    });
  }

  emit(event: TransportEvent): void {
    this.#context?.onEvent(event);
  }

  emitFrom(connection: number, event: TransportEvent): void {
    this.contexts[connection]?.onEvent(event);
  }
}

function makeEngine(
  transport: TestTransport,
  deps: Partial<RealtimeEngineDeps<TestUpdate, TestContext>> = {},
  options: RealtimeEngineOptions<TestContext> = {},
): RealtimeEngine<TestUpdate, TestContext, TestEvents> {
  return new RealtimeEngine<TestUpdate, TestContext, TestEvents>(
    {
      baseUrl: 'https://itd.test',
      fetch: globalThis.fetch,
      baseHeaders: () => Promise.resolve(new Headers()),
      getToken: () => Promise.resolve('token'),
      refresh: () => Promise.resolve(true),
      transport,
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

describe('realtime engine', () => {
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
    const router = new RealtimeRouter<'value', TestContext>(() => 'value');
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
      sync: async (_reason, dispatch) => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        dispatch({ value: 1 });
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
      sync: (_reason, dispatch) => {
        const value = ++syncSequence;
        return new Promise<void>((resolve) => {
          releases.push(() => {
            dispatch({ value });
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
