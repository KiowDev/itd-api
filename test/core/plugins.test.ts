import { describe, expect, it, vi } from 'vitest';
import { ItdClient } from '../../src/client.js';
import { ItdConfigError } from '../../src/core/errors.js';
import type { ClientPlugin, OperationTransformer } from '../../src/core/plugins/contracts.js';
import type { ItdClientOptions } from '../../src/options.js';
import { createMockFetch, json, type MockHandler } from '../helpers/mock-fetch.js';

function makeClient(handler: MockHandler | Response[], options: ItdClientOptions = {}) {
  const mock = createMockFetch(handler);
  const itd = new ItdClient({
    baseUrl: 'https://itd.test',
    fetch: mock.fetch,
    auth: 'test-token',
    retry: false,
    rateLimit: false,
    mode: 'server',
    ...options,
  });

  return { itd, mock };
}

/** Плагин из одной обёртки — самая частая форма. */
function plugin(name: string, transformer: OperationTransformer): ClientPlugin {
  return { name, install: ({ operations }) => void operations.use(transformer) };
}

describe('подключение плагинов', () => {
  it('без плагинов запрос идёт прежним путём', async () => {
    const { itd, mock } = makeClient([json({ data: { id: '1' } })]);

    await itd.posts.get('1');

    expect(mock.callCount).toBe(1);
  });

  it('use возвращает клиента — вызовы можно объединять', () => {
    const { itd } = makeClient([]);

    expect(itd.use(plugin('a', (r, next) => next(r)))).toBe(itd);
  });

  it('отвергает плагин без имени и без install', () => {
    const { itd } = makeClient([]);

    expect(() => itd.use({ name: '  ', install: () => {} })).toThrow(ItdConfigError);
    expect(() => itd.use({ name: 'a' } as unknown as ClientPlugin)).toThrow(ItdConfigError);
  });

  it('отвергает повторное подключение одного имени', () => {
    const { itd } = makeClient([]);
    itd.use(plugin('crypt', (r, next) => next(r)));

    expect(() => itd.use(plugin('crypt', (r, next) => next(r)))).toThrow(/уже подключён/);
  });

  it('передаёт плагину базовый URL', () => {
    const { itd } = makeClient([]);
    let seen = '';

    itd.use({
      name: 'probe',
      install(context) {
        seen = context.baseUrl;
      },
    });

    expect(seen).toBe('https://itd.test');
  });
});

describe('обёртки запроса', () => {
  it('передаёт стабильный operationId независимо от HTTP-пути', async () => {
    const { itd } = makeClient([
      json({ data: { id: '1' } }),
      json({ data: { ok: true } }),
      json({ data: { ok: true } }),
    ]);
    const seen: Array<[string, string, string]> = [];

    itd.use(
      plugin('operations', (request, next) => {
        seen.push([request.operationId, request.method, request.path]);
        return next(request);
      }),
    );

    await itd.posts.get('1');
    await itd.request({ method: 'GET', path: '/api/posts/1' });
    await itd.request({
      operationId: 'custom:probe',
      method: 'POST',
      path: '/integration/probe',
    });

    expect(seen).toEqual([
      ['posts.get', 'GET', '/api/posts/1'],
      ['raw', 'GET', '/api/posts/1'],
      ['custom:probe', 'POST', '/integration/probe'],
    ]);
  });

  it('правит тело запроса до отправки', async () => {
    const { itd, mock } = makeClient([json({ data: { id: '1' } })]);

    itd.use(
      plugin('upper', (request, next) => {
        const body = request.body as { content: string };
        return next({ ...request, body: { ...body, content: body.content.toUpperCase() } });
      }),
    );

    await itd.posts.create({ content: 'привет' });

    expect(JSON.parse(mock.calls[0]?.body ?? '{}')).toMatchObject({ content: 'ПРИВЕТ' });
  });

  it('правит разобранный ответ', async () => {
    const { itd } = makeClient([json({ data: { id: '1', content: 'пост' } })]);

    itd.use(
      plugin('mark', async (request, next) => {
        const result = (await next(request)) as Record<string, unknown>;
        result.marked = true;
        return result;
      }),
    );

    const post = await itd.posts.get('1');

    expect(post).toMatchObject({ id: '1', marked: true });
  });

  it('может ответить сам, не ходя в сеть', async () => {
    const { itd, mock } = makeClient([]);

    itd.use(plugin('cache', async () => ({ id: 'из кэша' })));

    await expect(itd.posts.get('1')).resolves.toMatchObject({ id: 'из кэша' });
    expect(mock.callCount).toBe(0);
  });

  it('подключённая раньше обёртка оказывается снаружи', async () => {
    const { itd } = makeClient([json({ data: {} })]);
    const order: string[] = [];

    const trace =
      (name: string): OperationTransformer =>
      async (request, next) => {
        order.push(`→ ${name}`);
        const result = await next(request);
        order.push(`← ${name}`);
        return result;
      };

    itd.use(plugin('первый', trace('первый')));
    itd.use(plugin('второй', trace('второй')));

    await itd.posts.get('1');

    expect(order).toEqual(['→ первый', '→ второй', '← второй', '← первый']);
  });

  it('выполняется один раз, сколько бы повторов ни понадобилось', async () => {
    let attempts = 0;
    const { itd } = makeClient(
      () => {
        attempts += 1;
        return attempts < 3
          ? json({ message: 'ой' }, { status: 500 })
          : json({ data: { id: '1' } });
      },
      { retry: { attempts: 3, baseDelay: 0, jitter: 0 } },
    );

    let runs = 0;
    itd.use(
      plugin('counter', (request, next) => {
        runs += 1;
        return next(request);
      }),
    );

    await itd.posts.get('1');

    expect(attempts).toBe(3);
    expect(runs).toBe(1);
  });

  it('не позволяет обёртке породить вторую логическую операцию', async () => {
    const { itd, mock } = makeClient([json({ data: { id: '1' } })]);
    let started: Promise<unknown> | undefined;

    itd.use(
      plugin('duplicator', async (request, next) => {
        started = next(request);
        return Promise.all([started, next(request)]);
      }),
    );

    const error = await itd.posts.create({ content: 'привет' }).catch((e: unknown) => e);
    await started;

    expect(error).toBeInstanceOf(ItdConfigError);
    expect((error as Error).message).toMatch(
      /плагина «duplicator» вызвал next\(\) больше одного раза/,
    );
    expect(mock.callCount).toBe(1);
  });
});

describe('namespaces расширений операции', () => {
  it('доносит extensions от метода ресурса до transformer', async () => {
    const { itd } = makeClient([json({ data: {} })]);
    let seen: unknown;

    itd.use(
      plugin('probe', (request, next) => {
        seen = (request.extensions as { probe?: { value?: string } } | undefined)?.probe?.value;
        return next(request);
      }),
    );

    await itd.posts.create({ content: 'привет' }, {
      extensions: { probe: { value: 'дошло' } },
    } as Parameters<typeof itd.posts.create>[1]);

    expect(seen).toBe('дошло');
  });

  it('endpoint params не смешиваются с execution options', async () => {
    const { itd } = makeClient([json({ data: {} })]);
    let request: Record<string, unknown> = {};

    itd.use(
      plugin('probe', (current, next) => {
        request = current as unknown as Record<string, unknown>;
        return next(current);
      }),
    );

    await itd.posts.list({ limit: 5 }, { extensions: { probe: { value: 'дошло' } } } as Parameters<
      typeof itd.posts.list
    >[1]);

    expect(request.limit).toBeUndefined();
    expect(request.query).toMatchObject({ limit: 5 });
    expect(request.extensions).toEqual({ probe: { value: 'дошло' } });
  });
});

describe('плагин, упавший при подключении', () => {
  /** Ставит обёртку и только потом падает — половина работы уже сделана. */
  function broken(onRun: () => void): ClientPlugin {
    return {
      name: 'broken',
      install: ({ operations }) => {
        operations.use((request, next) => {
          onRun();
          return next(request);
        });
        throw new Error('не сложилось');
      },
    };
  }

  it('не оставляет за собой обёртку', async () => {
    const { itd } = makeClient([json({ data: {} })]);
    const ran: string[] = [];

    itd.use(
      plugin('first', (request, next) => {
        ran.push('first');
        return next(request);
      }),
    );

    expect(() => itd.use(broken(() => ran.push('broken')))).toThrow('не сложилось');

    await itd.posts.get('1');

    expect(ran).toEqual(['first']);
  });

  it('не занимает своё имя — можно подключить исправленный', () => {
    const { itd } = makeClient([]);

    expect(() => itd.use(broken(() => {}))).toThrow('не сложилось');
    expect(() => itd.use(plugin('broken', (r, next) => next(r)))).not.toThrow();
  });
});

describe('порядок и зависимости плагинов', () => {
  const traced = (definition: Omit<ClientPlugin, 'install'>, order: string[]): ClientPlugin => ({
    ...definition,
    install({ operations }) {
      operations.use(async (request, next) => {
        order.push(`→ ${definition.name}`);
        const result = await next(request);
        order.push(`← ${definition.name}`);
        return result;
      });
    },
  });

  it('перестраивает цепочку по before и after независимо от порядка use()', async () => {
    const { itd } = makeClient([json({ data: {} })]);
    const order: string[] = [];

    itd.use(traced({ name: 'middle' }, order));
    itd.use(traced({ name: 'outer', before: ['middle'] }, order));
    itd.use(traced({ name: 'inner', after: ['middle'] }, order));

    expect(itd.pluginNames()).toEqual(['outer', 'middle', 'inner']);
    await itd.posts.get('1');
    expect(order).toEqual(['→ outer', '→ middle', '→ inner', '← inner', '← middle', '← outer']);
  });

  it('requires проверяет наличие и ставит зависимость раньше', () => {
    const { itd } = makeClient([]);
    const dependent = traced({ name: 'dependent', requires: ['base'] }, []);

    expect(() => itd.use(dependent)).toThrow(/требуется плагин «base»/);

    itd.use(traced({ name: 'base' }, []));
    itd.use(dependent);
    expect(itd.pluginNames()).toEqual(['base', 'dependent']);
  });

  it('учитывает конфликт, объявленный с любой стороны', () => {
    const { itd } = makeClient([]);
    itd.use(traced({ name: 'first', conflicts: ['second'] }, []));

    expect(() => itd.use(traced({ name: 'second' }, []))).toThrow(/несовместим/);
    expect(itd.pluginNames()).toEqual(['first']);
  });

  it('отклоняет цикл до install нового плагина', () => {
    const { itd } = makeClient([]);
    const install = vi.fn();
    itd.use(traced({ name: 'a', before: ['b'] }, []));

    expect(() => itd.use({ name: 'b', before: ['a'], install })).toThrow(/циклический порядок/);
    expect(install).not.toHaveBeenCalled();
  });

  it('проверяет метаданные отношений', () => {
    const { itd } = makeClient([]);

    expect(() => itd.use({ name: 'a', before: ['a'], install() {} })).toThrow(
      /не может указать себя/,
    );
    expect(() => itd.use({ name: 'a', after: ['b', 'b'], install() {} })).toThrow(/повторяет имя/);
  });
});

describe('раздельные operation transformers и attempt interceptors', () => {
  it('применяет before/after к attempt chain в том же порядке, что к operations', async () => {
    const { itd } = makeClient([json({ data: { id: '1' } })]);
    const events: string[] = [];
    const attemptPlugin = (name: string, before?: readonly string[]): ClientPlugin => ({
      name,
      ...(before ? { before } : {}),
      install({ attempts }) {
        attempts.use(async (_context, next) => {
          events.push(`→ ${name}`);
          const response = await next();
          events.push(`← ${name}`);
          return response;
        });
      },
    });

    itd.use(attemptPlugin('inner'));
    itd.use(attemptPlugin('outer', ['inner']));
    await itd.posts.get('1');

    expect(events).toEqual(['→ outer', '→ inner', '← inner', '← outer']);
  });

  it('оборачивает каждую транспортную попытку и видит сырой Response', async () => {
    let attempts = 0;
    const { itd } = makeClient(
      () => {
        attempts += 1;
        return attempts === 1
          ? json({ message: 'временно' }, { status: 500 })
          : json({ data: { id: '1' } });
      },
      { retry: { attempts: 2, baseDelay: 0, jitter: 0 } },
    );
    const events: string[] = [];

    itd.use({
      name: 'observe',
      install({ attempts: wireAttempts }) {
        wireAttempts.use(async (context, next) => {
          events.push(`request:${context.operationId}:${context.attempt}`);
          try {
            const response = await next();
            events.push(`response:${context.operationId}:${context.attempt}:${response.status}`);
            return response;
          } catch (error) {
            events.push(`error:${context.operationId}:${context.attempt}`);
            throw error;
          }
        });
      },
    });

    await itd.posts.get('1');

    expect(events).toEqual([
      'request:posts.get:1',
      'response:posts.get:1:500',
      'request:posts.get:2',
      'response:posts.get:2:200',
    ]);
  });

  it('получает resolved URL и headers после operation transformer и client hook', async () => {
    const events: string[] = [];
    const { itd, mock } = makeClient([json({ data: { id: '1' } })], {
      hooks: {
        onRequest: ({ headers }) => {
          events.push('client');
          headers.set('X-Client-Hook', 'yes');
        },
      },
    });
    itd.use({
      name: 'observe',
      install({ operations, attempts: wireAttempts }) {
        operations.use((request, next) =>
          next({ ...request, headers: { ...request.headers, 'X-Operation': 'yes' } }),
        );
        wireAttempts.use(async ({ url, headers, attempt, body, signal }, next) => {
          events.push(`attempt:${attempt}:${new URL(url).pathname}`);
          expect(body).toBeUndefined();
          expect(signal).toBeInstanceOf(AbortSignal);
          expect(headers.get('x-client-hook')).toBe('yes');
          expect(headers.get('x-operation')).toBe('yes');
          headers.set('X-Attempt', 'yes');
          return next();
        });
      },
    });

    await itd.posts.get('1');
    expect(events).toEqual(['client', 'attempt:1:/api/posts/1']);
    expect(mock.calls[0]?.headers.get('x-attempt')).toBe('yes');
  });

  it('проверяет interceptor при регистрации', () => {
    const { itd } = makeClient([]);

    expect(() =>
      itd.use({
        name: 'broken-attempts',
        install({ attempts }) {
          attempts.use('нет' as unknown as Parameters<typeof attempts.use>[0]);
        },
      }),
    ).toThrow(/attempts\.use\(\) не функцию/);
    expect(itd.hasPlugin('broken-attempts')).toBe(false);
  });

  it('возвращает независимые unsubscribe для обеих точек расширения', async () => {
    const { itd } = makeClient([json({ data: { id: '1' } })]);
    const events: string[] = [];
    let stopOperation = () => {};
    let stopAttempt = () => {};
    itd.use({
      name: 'removable-extensions',
      install({ operations, attempts }) {
        stopOperation = operations.use((request, next) => {
          events.push('operation');
          return next(request);
        });
        stopAttempt = attempts.use(async (_context, next) => {
          events.push('attempt');
          return next();
        });
      },
    });

    stopOperation();
    stopOperation();
    stopAttempt();
    stopAttempt();
    await itd.posts.get('1');

    expect(events).toEqual([]);
  });

  it('не позволяет interceptor вызвать next дважды', async () => {
    const { itd, mock } = makeClient([json({ data: { id: '1' } })]);
    itd.use({
      name: 'double-next',
      install({ attempts }) {
        attempts.use(async (_context, next) => {
          await next();
          return next();
        });
      },
    });

    await expect(itd.posts.get('1')).rejects.toThrow(/next\(\) больше одного раза/);
    expect(mock.callCount).toBe(1);
  });

  it('не маскирует ошибку interceptor под сетевой сбой и не повторяет её', async () => {
    const { itd, mock } = makeClient([json({ data: { id: '1' } })], {
      retry: { attempts: 2, baseDelay: 0, jitter: 0 },
    });
    const failure = new Error('ошибка расширения');
    itd.use({
      name: 'broken-attempt',
      install({ attempts }) {
        attempts.use(async () => {
          throw failure;
        });
      },
    });

    await expect(itd.posts.get('1')).rejects.toBe(failure);
    expect(mock.callCount).toBe(0);
  });

  it('явно short-circuit попытку синтетическим Response', async () => {
    const { itd, mock } = makeClient([]);
    itd.use({
      name: 'synthetic',
      install({ attempts }) {
        attempts.use(async () => json({ data: { id: 'local' } }));
      },
    });

    await expect(itd.posts.get('1')).resolves.toMatchObject({ id: 'local' });
    expect(mock.callCount).toBe(0);
  });

  it('отклоняет не-Response при attempt short-circuit', async () => {
    const { itd, mock } = makeClient([]);
    itd.use({
      name: 'invalid-synthetic',
      install({ attempts }) {
        attempts.use(async () => ({}) as Response);
      },
    });

    await expect(itd.posts.get('1')).rejects.toThrow(/должен вернуть Response/);
    expect(mock.callCount).toBe(0);
  });

  it('сохраняет снимок interceptors до конца начатой логической операции', async () => {
    let attempts = 0;
    const { itd } = makeClient(
      () => {
        attempts += 1;
        return attempts === 1
          ? json({ message: 'временно' }, { status: 500 })
          : json({ data: { id: '1' } });
      },
      { retry: { attempts: 2, baseDelay: 0, jitter: 0 } },
    );
    const events: string[] = [];
    const teardown = vi.fn();
    let removing: Promise<boolean> | undefined;

    itd.use({
      name: 'observe',
      install({ attempts: wireAttempts }) {
        wireAttempts.use(async ({ attempt }, next) => {
          events.push(`request:${attempt}`);
          if (attempt === 1) removing = itd.unuse('observe');
          const response = await next();
          events.push(`response:${attempt}:${response.status}`);
          return response;
        });
        return teardown;
      },
    });

    await itd.posts.get('1');
    await removing;

    expect(events).toEqual(['request:1', 'response:1:500', 'request:2', 'response:2:200']);
    expect(teardown).toHaveBeenCalledOnce();
  });
});

describe('отключение плагинов и очистка ресурсов', () => {
  it('unuse удаляет расширения и имя плагина', async () => {
    const { itd } = makeClient([json({ data: { id: '1' } }), json({ data: { id: '2' } })]);
    let runs = 0;
    itd.use(
      plugin('temporary', (request, next) => {
        runs += 1;
        return next(request);
      }),
    );

    expect(itd.hasPlugin('temporary')).toBe(true);
    await itd.posts.get('1');
    expect(await itd.unuse('temporary')).toBe(true);
    expect(await itd.unuse('temporary')).toBe(false);
    expect(itd.hasPlugin('temporary')).toBe(false);
    expect(itd.pluginNames()).toEqual([]);

    await itd.posts.get('2');
    expect(runs).toBe(1);
  });

  it('не отключает обязательную зависимость раньше зависимого плагина', async () => {
    const { itd } = makeClient([]);
    itd.use(plugin('base', (request, next) => next(request)));
    itd.use({
      name: 'dependent',
      requires: ['base'],
      install() {},
    });

    await expect(itd.unuse('base')).rejects.toThrow(/зависит «dependent»/);
    expect(itd.pluginNames()).toEqual(['base', 'dependent']);
  });

  it('teardown дожидается уже выполняющегося запроса', async () => {
    let release: (() => void) | undefined;
    const response = new Promise<Response>((resolve) => {
      release = () => resolve(json({ data: { id: '1' } }));
    });
    const { itd, mock } = makeClient(() => response);
    const teardown = vi.fn();
    itd.use({
      name: 'resourceful',
      install({ operations }) {
        operations.use((request, next) => next(request));
        return teardown;
      },
    });

    const request = itd.posts.get('1');
    await vi.waitFor(() => expect(mock.callCount).toBe(1));
    const removing = itd.unuse('resourceful');
    await Promise.resolve();
    expect(teardown).not.toHaveBeenCalled();

    release?.();
    await Promise.all([request, removing]);
    expect(teardown).toHaveBeenCalledOnce();
  });

  it('dispose очищает плагины изнутри наружу и остаётся идемпотентным', async () => {
    const { itd } = makeClient([]);
    const order: string[] = [];
    itd.use({
      name: 'outer',
      install: () => () => {
        order.push('outer');
      },
    });
    itd.use({
      name: 'inner',
      install: () => () => {
        order.push('inner');
      },
    });

    await itd.dispose();
    await itd.dispose();

    expect(order).toEqual(['inner', 'outer']);
    expect(itd.pluginNames()).toEqual([]);
  });

  it('повторный dispose возвращает тот же результат, включая ошибку teardown', async () => {
    const { itd } = makeClient([]);
    const failure = new Error('teardown failed');
    itd.use({
      name: 'broken-cleanup',
      install: () => () => {
        throw failure;
      },
    });

    const first = itd.dispose();
    const second = itd.dispose();

    expect(second).toBe(first);
    await expect(first).rejects.toThrow('Не удалось освободить клиент');
    await expect(itd.dispose()).rejects.toThrow('Не удалось освободить клиент');
  });

  it('await using вызывает teardown плагина', async () => {
    const { itd } = makeClient([]);
    const teardown = vi.fn();
    itd.use({ name: 'resourceful', install: () => teardown });

    {
      await using guard = itd;
      expect(guard.hasPlugin('resourceful')).toBe(true);
    }

    expect(teardown).toHaveBeenCalledOnce();
    expect(itd.hasPlugin('resourceful')).toBe(false);
  });

  it('dispose дожидается teardown, уже запущенного через unuse', async () => {
    let release: (() => void) | undefined;
    let cleanupStarted = false;
    const cleanup = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { itd } = makeClient([]);
    itd.use({
      name: 'slow-cleanup',
      install: () => async () => {
        cleanupStarted = true;
        await cleanup;
      },
    });

    const removing = itd.unuse('slow-cleanup');
    await vi.waitFor(() => expect(cleanupStarted).toBe(true));

    let disposed = false;
    const disposing = itd.dispose().then(() => {
      disposed = true;
    });
    await Promise.resolve();
    expect(disposed).toBe(false);

    release?.();
    await Promise.all([removing, disposing]);
    expect(disposed).toBe(true);
  });
});
