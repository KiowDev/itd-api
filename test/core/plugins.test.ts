import { describe, expect, it, vi } from 'vitest';
import { ItdClient } from '../../src/client.js';
import { ItdConfigError } from '../../src/core/errors.js';
import type { ItdPlugin, Transformer } from '../../src/core/plugins/contracts.js';
import type { ItdClientOptions } from '../../src/types/options.js';
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
function plugin(
  name: string,
  transformer: Transformer,
  optionKeys: readonly string[] = [],
): ItdPlugin {
  return { name, optionKeys, install: ({ use }) => use(transformer) };
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
    expect(() => itd.use({ name: 'a' } as unknown as ItdPlugin)).toThrow(ItdConfigError);
  });

  it('отвергает повторное подключение одного имени', () => {
    const { itd } = makeClient([]);
    itd.use(plugin('crypt', (r, next) => next(r)));

    expect(() => itd.use(plugin('crypt', (r, next) => next(r)))).toThrow(/уже подключён/);
  });

  it('передаёт плагину базовый URL', () => {
    const { itd } = makeClient([]);
    let seen = '';

    itd.use({ name: 'probe', install: (context) => (seen = context.baseUrl) });

    expect(seen).toBe('https://itd.test');
  });
});

describe('обёртки запроса', () => {
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
      (name: string): Transformer =>
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
});

describe('опции плагинов', () => {
  it('доносит заявленные опции от метода ресурса до обёртки', async () => {
    const { itd } = makeClient([json({ data: {} })]);
    let seen: unknown;

    itd.use(
      plugin(
        'crypt',
        (request, next) => {
          seen = (request as unknown as Record<string, unknown>).encrypt;
          return next(request);
        },
        ['encrypt'],
      ),
    );

    await itd.posts.create({ content: 'привет' }, {
      encrypt: 'invis',
    } as Parameters<typeof itd.posts.create>[1]);

    expect(seen).toBe('invis');
  });

  it('незаявленные поля опций до обёртки не доходят', async () => {
    const { itd } = makeClient([json({ data: {} })]);
    let request: Record<string, unknown> = {};

    itd.use(
      plugin(
        'crypt',
        (current, next) => {
          request = current as unknown as Record<string, unknown>;
          return next(current);
        },
        ['encrypt'],
      ),
    );

    await itd.posts.get('1', { maxPages: 5, encrypt: 'invis' } as Parameters<
      typeof itd.posts.get
    >[1]);

    expect(request.encrypt).toBe('invis');
    expect(request.maxPages).toBeUndefined();
  });

  it('не даёт заявить имя поля запроса', () => {
    const { itd } = makeClient([]);

    for (const key of ['path', 'body', 'method', 'headers', 'signal', 'skipAuth', 'raw']) {
      expect(() => itd.use(plugin(`p-${key}`, (r, next) => next(r), [key]))).toThrow(
        ItdConfigError,
      );
    }
  });

  it('плагин с занятым именем опции не подключается вовсе', async () => {
    const { itd, mock } = makeClient([json({ data: { id: '1' } })]);
    let ran = false;

    expect(() =>
      itd.use({
        name: 'hijack',
        optionKeys: ['path'],
        install: ({ use }) =>
          use((request, next) => {
            ran = true;
            return next(request);
          }),
      }),
    ).toThrow(ItdConfigError);

    await itd.posts.get('1');

    // Ни обёртка не встала в цепочку, ни путь не подменился.
    expect(ran).toBe(false);
    expect(mock.calls[0]?.url).toContain('/api/posts/1');
  });
});

describe('плагин, упавший при подключении', () => {
  /** Ставит обёртку и только потом падает — половина работы уже сделана. */
  function broken(onRun: () => void): ItdPlugin {
    return {
      name: 'broken',
      install: ({ use }) => {
        use((request, next) => {
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

describe('Plugin API 2.0: порядок и зависимости', () => {
  const traced = (definition: Omit<ItdPlugin, 'install'>, order: string[]): ItdPlugin => ({
    ...definition,
    install({ use }) {
      use(async (request, next) => {
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

describe('Plugin API 2.0: lifecycle hooks', () => {
  it('видит каждую попытку, ошибку, retry и успешный ответ', async () => {
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
      install({ useHooks }) {
        useHooks({
          onRequest: ({ attempt }) => {
            events.push(`request:${attempt}`);
          },
          onResponse: ({ attempt, status }) => {
            events.push(`response:${attempt}:${status}`);
          },
          onError: ({ attempt }) => {
            events.push(`error:${attempt}`);
          },
          onRetry: ({ attempt }) => {
            events.push(`retry:${attempt}`);
          },
        });
      },
    });

    await itd.posts.get('1');

    expect(events).toEqual(['request:1', 'error:1', 'retry:1', 'request:2', 'response:2:200']);
  });

  it('вызывает конструкторский hook раньше plugin hook', async () => {
    const events: string[] = [];
    const { itd } = makeClient([json({ data: {} })], {
      hooks: {
        onRequest: () => {
          events.push('client');
        },
      },
    });
    itd.use({
      name: 'observe',
      install({ useHooks }) {
        useHooks({
          onRequest: () => {
            events.push('plugin');
          },
        });
      },
    });

    await itd.posts.get('1');
    expect(events).toEqual(['client', 'plugin']);
  });

  it('проверяет переданный набор хуков', () => {
    const { itd } = makeClient([]);

    expect(() =>
      itd.use({
        name: 'broken-hooks',
        install({ useHooks }) {
          useHooks({ onRequest: 'нет' } as unknown as Parameters<typeof useHooks>[0]);
        },
      }),
    ).toThrow(/onRequest должен быть функцией/);
    expect(itd.hasPlugin('broken-hooks')).toBe(false);
  });

  it('сохраняет снимок хуков до конца уже начатого логического запроса', async () => {
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
      install({ useHooks }) {
        useHooks({
          onRequest({ attempt }) {
            events.push(`request:${attempt}`);
            if (attempt === 1) removing = itd.unuse('observe');
          },
          onResponse({ attempt }) {
            events.push(`response:${attempt}`);
          },
          onError({ attempt }) {
            events.push(`error:${attempt}`);
          },
          onRetry({ attempt }) {
            events.push(`retry:${attempt}`);
          },
        });
        return teardown;
      },
    });

    await itd.posts.get('1');
    await removing;

    expect(events).toEqual(['request:1', 'error:1', 'retry:1', 'request:2', 'response:2']);
    expect(teardown).toHaveBeenCalledOnce();
  });
});

describe('Plugin API 2.0: отключение и очистка', () => {
  it('unuse удаляет обёртку, опции и имя плагина', async () => {
    const { itd } = makeClient([json({ data: { id: '1' } }), json({ data: { id: '2' } })]);
    let runs = 0;
    itd.use(
      plugin(
        'temporary',
        (request, next) => {
          runs += 1;
          return next(request);
        },
        ['temporaryOption'],
      ),
    );

    expect(itd.hasPlugin('temporary')).toBe(true);
    await itd.posts.get('1');
    expect(await itd.unuse('temporary')).toBe(true);
    expect(await itd.unuse('temporary')).toBe(false);
    expect(itd.hasPlugin('temporary')).toBe(false);
    expect(itd.pluginNames()).toEqual([]);

    await itd.posts.get('2', {
      temporaryOption: true,
    } as Parameters<typeof itd.posts.get>[1]);
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
      install({ use }) {
        use((request, next) => next(request));
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
      install: () => () => order.push('outer'),
    });
    itd.use({
      name: 'inner',
      install: () => () => order.push('inner'),
    });

    await itd.dispose();
    await itd.dispose();

    expect(order).toEqual(['inner', 'outer']);
    expect(itd.pluginNames()).toEqual([]);
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
