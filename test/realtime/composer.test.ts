import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { ItdConfigError } from '../../src/core/errors.js';
import { RealtimeComposer, type RealtimeMiddlewareLike } from '../../src/realtime/composer.js';
import { captureRealtimeMiddleware } from '../../src/realtime/middleware.js';
import type { RealtimeContextBase } from '../../src/realtime/updates.js';

type TestUpdate =
  | { readonly type: 'message'; readonly text: string }
  | { readonly type: 'count'; readonly value: number }
  | { readonly type: 'unknown' };

type TestContext = RealtimeContextBase<TestUpdate, { readonly name: 'test' }> & {
  trace?: string[];
};

type MessageContext = TestContext & {
  readonly update: Extract<TestUpdate, { type: 'message' }>;
};

function context(update: TestUpdate): TestContext {
  return {
    update,
    stream: { name: 'test' },
    raw: undefined,
    origin: 'sync',
  };
}

async function execute(
  composer: RealtimeComposer<TestContext>,
  current: TestContext,
  terminal: () => void | Promise<void> = () => {},
): Promise<void> {
  const middleware = captureRealtimeMiddleware(composer.middleware());
  await middleware(current, async () => terminal());
}

describe('RealtimeComposer', () => {
  it('constructor и use строят onion-цепочку, а пустой composer пропускает update', async () => {
    const empty = new RealtimeComposer<TestContext>();
    const terminal = vi.fn();
    await execute(empty, context({ type: 'unknown' }), terminal);
    expect(terminal).toHaveBeenCalledOnce();

    const order: string[] = [];
    const composer = new RealtimeComposer<TestContext>(async (_context, next) => {
      order.push('constructor:before');
      await next();
      order.push('constructor:after');
    });
    composer.use(
      async (_context, next) => {
        order.push('outer:before');
        await next();
        order.push('outer:after');
      },
      async (_context, next) => {
        order.push('inner:before');
        await next();
        order.push('inner:after');
      },
    );

    await execute(composer, context({ type: 'unknown' }), () => {
      order.push('terminal');
    });

    expect(order).toEqual([
      'constructor:before',
      'outer:before',
      'inner:before',
      'terminal',
      'inner:after',
      'outer:after',
      'constructor:after',
    ]);
  });

  it('use не оставляет частично добавленную группу после ошибки конфигурации', async () => {
    const composer = new RealtimeComposer<TestContext>();
    const valid = vi.fn();

    expect(() => composer.use(valid, {} as never)).toThrow(ItdConfigError);
    await execute(composer, context({ type: 'unknown' }));

    expect(valid).not.toHaveBeenCalled();
  });

  it('сохраняет short-circuit middleware', async () => {
    const composer = new RealtimeComposer<TestContext>();
    const downstream = vi.fn();
    composer.use(() => {}).use(downstream);

    await execute(composer, context({ type: 'unknown' }));

    expect(downstream).not.toHaveBeenCalled();
  });

  it('filter поддерживает type guard, async predicate и дочерние цепочки', async () => {
    const composer = new RealtimeComposer<TestContext>();
    const seen: string[] = [];
    const messages = composer.filter(
      (current): current is MessageContext => current.update.type === 'message',
    );
    messages.use(async (current, next) => {
      expectTypeOf(current).toEqualTypeOf<MessageContext>();
      seen.push(current.update.text);
      await next();
    });
    composer
      .filter(async (current) => current.update.type === 'count')
      .use(async (current, next) => {
        if (current.update.type === 'count') seen.push(String(current.update.value));
        await next();
      });

    await execute(composer, context({ type: 'message', text: 'привет' }));
    await execute(composer, context({ type: 'count', value: 3 }));
    await execute(composer, context({ type: 'unknown' }));

    expect(seen).toEqual(['привет', '3']);
  });

  it('route выбирает одну ветку, поддерживает fallback и symbol keys', async () => {
    const composer = new RealtimeComposer<TestContext>();
    const seen: string[] = [];
    const special = Symbol('special');

    composer.route(
      async (current) => {
        if (current.update.type === 'message') return 'message';
        if (current.update.type === 'count') return special;
        return 'missing';
      },
      {
        message: [
          async (_context, next) => {
            seen.push('message:first');
            await next();
          },
          {
            middleware: () => async (_context, next) => {
              seen.push('message:object');
              await next();
            },
          },
        ],
        [special]: {
          middleware: () => async (_context, next) => {
            seen.push('count');
            await next();
          },
        },
      },
      async (_context, next) => {
        seen.push('fallback');
        await next();
      },
    );

    await execute(composer, context({ type: 'message', text: 'x' }));
    await execute(composer, context({ type: 'count', value: 1 }));
    await execute(composer, context({ type: 'unknown' }));

    expect(seen).toEqual(['message:first', 'message:object', 'count', 'fallback']);
  });

  it('route без fallback пропускает неизвестный ключ дальше', async () => {
    const composer = new RealtimeComposer<TestContext>();
    const terminal = vi.fn();
    composer.route((): 'known' | 'missing' => 'missing', {
      known: () => {},
    });

    await execute(composer, context({ type: 'unknown' }), terminal);

    expect(terminal).toHaveBeenCalledOnce();
  });

  it('route направляет null и undefined в fallback', async () => {
    const composer = new RealtimeComposer<TestContext>();
    const fallback = vi.fn(async (_context, next) => next());
    let route: 'known' | null | undefined;
    composer.route(() => route, { known: () => {} }, fallback);

    route = null;
    await execute(composer, context({ type: 'unknown' }));
    route = undefined;
    await execute(composer, context({ type: 'unknown' }));

    expect(fallback).toHaveBeenCalledTimes(2);
  });

  it('фиксирует снимок родительских и дочерних middleware в момент получения update', async () => {
    const composer = new RealtimeComposer<TestContext>();
    const child = composer.filter(() => true);
    const seen: string[] = [];
    composer.use(async (_context, next) => {
      seen.push('parent:old');
      await next();
    });
    child.use(async (_context, next) => {
      seen.push('child:old');
      await next();
    });

    const captured = captureRealtimeMiddleware(composer.middleware());
    composer.use(async (_context, next) => {
      seen.push('parent:new');
      await next();
    });
    child.use(async (_context, next) => {
      seen.push('child:new');
      await next();
    });

    const current = context({ type: 'unknown' });
    await captured(current, async () => {});
    expect(seen).toEqual(['child:old', 'parent:old']);

    seen.length = 0;
    await execute(composer, current);
    expect(seen).toEqual(['child:old', 'child:new', 'parent:old', 'parent:new']);
  });

  it('снимает объектный middleware отдельно для каждого snapshot', async () => {
    const composer = new RealtimeComposer<TestContext>();
    const seen: string[] = [];
    let version = 'old';
    const feature: RealtimeMiddlewareLike<TestContext> = {
      middleware() {
        const snapshot = version;
        return async (_context, next) => {
          seen.push(snapshot);
          await next();
        };
      },
    };
    composer.use(feature);

    const old = captureRealtimeMiddleware(composer.middleware());
    version = 'new';
    const fresh = captureRealtimeMiddleware(composer.middleware());
    await old(context({ type: 'unknown' }), async () => {});
    await fresh(context({ type: 'unknown' }), async () => {});

    expect(seen).toEqual(['old', 'new']);
  });

  it('передаёт ошибку создания snapshot в middleware pipeline', async () => {
    const composer = new RealtimeComposer<TestContext>();
    const failure = new Error('snapshot');
    composer.use({
      middleware() {
        throw failure;
      },
    });

    await expect(execute(composer, context({ type: 'unknown' }))).rejects.toBe(failure);
  });

  it('errorBoundary ловит только дочернюю ошибку и может продолжить внешнюю цепочку', async () => {
    const composer = new RealtimeComposer<TestContext>();
    const failures: unknown[] = [];
    const safe = composer.errorBoundary(async (failure, next) => {
      failures.push(failure);
      await next();
    });
    safe.use(() => {
      throw new Error('внутри');
    });
    const after = vi.fn();
    composer.use(after);
    const current = context({ type: 'unknown' });

    await execute(composer, current);

    expect(failures).toEqual([{ error: expect.any(Error), context: current }]);
    expect(after).toHaveBeenCalledOnce();
  });

  it('errorBoundary останавливает цепочку без next и не ловит downstream', async () => {
    const stopped = new RealtimeComposer<TestContext>();
    const safe = stopped.errorBoundary(() => {});
    safe.use(() => {
      throw new Error('подавлено');
    });
    const after = vi.fn();
    stopped.use(after);
    await execute(stopped, context({ type: 'unknown' }));
    expect(after).not.toHaveBeenCalled();

    const downstream = new RealtimeComposer<TestContext>();
    const boundary = vi.fn();
    downstream.errorBoundary(boundary);
    downstream.use(() => {
      throw new Error('снаружи');
    });

    await expect(execute(downstream, context({ type: 'unknown' }))).rejects.toThrow('снаружи');
    expect(boundary).not.toHaveBeenCalled();
  });

  it('errorBoundary завершает защищённую onion-цепочку до внешнего downstream', async () => {
    const composer = new RealtimeComposer<TestContext>();
    const order: string[] = [];
    const safe = composer.errorBoundary(() => {});
    safe.use(async (_context, next) => {
      order.push('safe:before');
      await next();
      order.push('safe:after');
    });
    composer.use(async (_context, next) => {
      order.push('outside');
      await next();
    });

    await execute(composer, context({ type: 'unknown' }));

    expect(order).toEqual(['safe:before', 'safe:after', 'outside']);
  });

  it('errorBoundary ловит ошибки async predicate и route selector', async () => {
    const predicateFailure = new Error('predicate');
    const predicateErrors: unknown[] = [];
    const filtered = new RealtimeComposer<TestContext>();
    filtered
      .errorBoundary(({ error }) => {
        predicateErrors.push(error);
      })
      .filter(async () => {
        throw predicateFailure;
      });
    await execute(filtered, context({ type: 'unknown' }));
    expect(predicateErrors).toEqual([predicateFailure]);

    const selectorFailure = new Error('selector');
    const selectorErrors: unknown[] = [];
    const routed = new RealtimeComposer<TestContext>();
    routed
      .errorBoundary(({ error }) => {
        selectorErrors.push(error);
      })
      .route(
        async (): Promise<'known'> => {
          throw selectorFailure;
        },
        { known: () => {} },
      );
    await execute(routed, context({ type: 'unknown' }));
    expect(selectorErrors).toEqual([selectorFailure]);
  });

  it('внешняя errorBoundary ловит ошибку, повторно выброшенную внутренней границей', async () => {
    const composer = new RealtimeComposer<TestContext>();
    const original = new Error('original');
    const outerErrors: unknown[] = [];
    const outer = composer.errorBoundary(({ error }) => {
      outerErrors.push(error);
    });
    outer
      .errorBoundary(({ error }) => {
        throw error;
      })
      .use(() => {
        throw original;
      });

    await execute(composer, context({ type: 'unknown' }));

    expect(outerErrors).toEqual([original]);
  });

  it('повторно выброшенная и некорректная next ошибка выходят из boundary', async () => {
    const rethrow = new RealtimeComposer<TestContext>();
    rethrow
      .errorBoundary(({ error }) => {
        throw error;
      })
      .use(() => {
        throw new Error('повторно');
      });
    await expect(execute(rethrow, context({ type: 'unknown' }))).rejects.toThrow('повторно');

    const duplicate = new RealtimeComposer<TestContext>();
    duplicate
      .errorBoundary(async (_failure, next) => {
        await next();
        await next();
      })
      .use(() => {
        throw new Error('исходная');
      });
    await expect(execute(duplicate, context({ type: 'unknown' }))).rejects.toThrow(
      'next() в обработчике realtime error boundary вызван повторно',
    );
  });

  it('проверяет публичные аргументы до подключения к stream', () => {
    const composer = new RealtimeComposer<TestContext>();

    expect(() => composer.use({} as never)).toThrow(ItdConfigError);
    expect(() => composer.filter(null as never)).toThrow(/функцию условия/);
    expect(() => composer.route(() => 'x', {})).toThrow(/хотя бы одну ветку/);
    expect(() => composer.errorBoundary(null as never)).toThrow(/обработчик ошибки/);
  });
});
