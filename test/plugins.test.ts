import { describe, expect, it } from 'vitest';
import { ItdClient } from '../src/client.js';
import { ItdConfigError } from '../src/core/errors.js';
import type { ItdPlugin, Transformer } from '../src/core/plugins.js';
import type { ItdClientOptions } from '../src/types/options.js';
import { createMockFetch, json, type MockHandler } from './helpers/mock-fetch.js';

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
