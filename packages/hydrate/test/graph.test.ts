import { apiResponse, createMockFetch, postFixture } from '@itd-api/testing';
import { ItdClient, type Post } from 'itd-api';
import { describe, expect, it } from 'vitest';
import { hydrateClient } from '../src/index.js';

function pluginClient(transform: (value: Record<PropertyKey, unknown>) => void) {
  const mock = createMockFetch();
  mock.get('/api/posts/graph', apiResponse(postFixture({ id: 'graph' })), { repeat: true });
  const raw = new ItdClient({
    baseUrl: 'https://mock.itd.test',
    fetch: mock.fetch,
    auth: 'test-token',
    retry: false,
    rateLimit: false,
  });
  raw.use({
    name: 'graph-fixture',
    install({ use }) {
      use(async (request, next) => {
        const result = await next(request);
        transform(result as Record<PropertyKey, unknown>);
        return result;
      });
    },
  });
  return hydrateClient(raw);
}

describe('обход графа', () => {
  it('сохраняет циклы и общие ссылки массивов', async () => {
    class PluginArray extends Array<unknown> {}
    const itd = pluginClient((result) => {
      const shared = new PluginArray();
      shared.push(shared);
      result.first = shared;
      result.second = shared;
    });

    const post = (await itd.posts.get('graph')) as unknown as Post & {
      first: unknown[];
      second: unknown[];
    };
    expect(post.first).toBe(post.second);
    expect(post.first[0]).toBe(post.first);
    expect(post.first).toBeInstanceOf(PluginArray);
  });

  it('не вычисляет getter заранее и сохраняет дескрипторы', async () => {
    let reads = 0;
    let assigned: unknown;
    const itd = pluginClient((result) => {
      const shared = { related: postFixture({ id: 'shared-related' }) };
      const graphMeta = { direct: shared } as Record<PropertyKey, unknown>;
      Object.defineProperty(graphMeta, 'lazy', { get: () => shared });
      Object.defineProperty(graphMeta, 'self', {
        get() {
          return this;
        },
      });
      result.graphMeta = graphMeta;
      Object.defineProperty(result, 'lazyPost', {
        configurable: false,
        enumerable: false,
        get() {
          reads += 1;
          return postFixture({ id: 'lazy' });
        },
      });
      Object.defineProperty(result, 'readonlyMeta', {
        configurable: false,
        enumerable: false,
        writable: false,
        value: { related: postFixture({ id: 'readonly-related' }) },
      });
      Object.defineProperty(result, 'assigned', {
        configurable: true,
        enumerable: false,
        get: () => assigned,
        set: (value) => {
          assigned = value;
        },
      });
      Object.defineProperty(result, 'danger', {
        configurable: false,
        get() {
          throw new Error('getter вызван');
        },
      });
    });

    const post = (await itd.posts.get('graph')) as unknown as Post & {
      lazyPost: Post & { like(): unknown };
      readonlyMeta: { related: Post & { like(): unknown } };
      assigned: unknown;
      danger: unknown;
      graphMeta: {
        direct: { related: Post & { like(): unknown } };
        lazy: { related: Post & { like(): unknown } };
        self: unknown;
      };
    };
    expect(reads).toBe(0);
    expect(Object.getOwnPropertyDescriptor(post, 'lazyPost')).toMatchObject({
      configurable: false,
      enumerable: false,
    });
    expect(Object.getOwnPropertyDescriptor(post, 'readonlyMeta')).toMatchObject({
      configurable: false,
      enumerable: false,
      writable: false,
    });
    expect(typeof post.readonlyMeta.related.like).toBe('function');
    expect(post.graphMeta.lazy).toBe(post.graphMeta.direct);
    expect(post.graphMeta.self).toBe(post.graphMeta);
    expect(typeof post.graphMeta.lazy.related.like).toBe('function');
    expect(typeof post.lazyPost.like).toBe('function');
    expect(reads).toBe(1);
    post.assigned = 'значение';
    expect(assigned).toBe('значение');
    expect(() => post.danger).toThrow('getter вызван');
  });

  it('использует методы гидратации вместо одноимённых полей', async () => {
    const itd = pluginClient((result) => {
      Object.defineProperty(result, 'like', {
        configurable: false,
        value: 'поле плагина',
      });
    });

    const post = await itd.posts.get('graph');
    expect(typeof post.like).toBe('function');
  });

  it('создаёт действия лениво и сохраняет отдельный вызов метода', async () => {
    const itd = pluginClient((result) => {
      result.originalPost = postFixture({ id: 'original' });
    });

    const post = await itd.posts.get('graph');
    const descriptor = Object.getOwnPropertyDescriptor(post, 'get');
    const originalDescriptor = Object.getOwnPropertyDescriptor(post.originalPost ?? {}, 'get');
    expect(descriptor?.value).toBeUndefined();
    expect(descriptor?.get).toBe(originalDescriptor?.get);
    expect(post.get).toBe(post.get);

    const get = post.get;
    await expect(get()).resolves.toMatchObject({ id: 'graph' });
  });
});
