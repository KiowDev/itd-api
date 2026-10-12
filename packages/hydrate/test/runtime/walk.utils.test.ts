import { apiResponse, createMockFetch, postFixture } from '@itd-api/testing';
import { ItdClient, type Post } from 'itd-api';
import { describe, expect, it } from 'vitest';
import { hydrateClient } from '../../src/index.js';

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
    install({ operations }) {
      operations.use(async (request, next) => {
        const result = await next(request);
        transform(result as Record<PropertyKey, unknown>);
        return result;
      });
    },
  });
  return hydrateClient(raw);
}

describe('обход по форме', () => {
  it('переносит поля вне схемы как есть', async () => {
    const related = postFixture({ id: 'related' });
    let reads = 0;
    const itd = pluginClient((result) => {
      result.related = related;
      Object.defineProperty(result, 'lazy', {
        get() {
          reads += 1;
          return related;
        },
      });
    });

    const post = (await itd.posts.get('graph')) as unknown as Post & {
      related: Post;
      lazy: Post;
    };
    expect(post.related).toBe(related);
    expect('like' in post.related).toBe(false);
    expect(reads).toBe(0);
    expect(post.lazy).toBe(related);
  });

  it('не вычисляет геттер поля схемы заранее', async () => {
    let reads = 0;
    const itd = pluginClient((result) => {
      const author = result.author;
      Object.defineProperty(result, 'author', {
        enumerable: true,
        get() {
          reads += 1;
          return author;
        },
      });
    });

    const post = await itd.posts.get('graph');
    expect(reads).toBe(0);
    expect(typeof post.author.follow).toBe('function');
    expect(reads).toBe(1);
  });

  it('использует действия вместо одноимённых полей', async () => {
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
