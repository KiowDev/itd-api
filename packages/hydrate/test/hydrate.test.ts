import { cache } from '@itd-api/cache';
import { crypt, encodeInvisible } from '@itd-api/crypto';
import {
  apiResponse,
  commentFixture,
  createMockFetch,
  createMockServer,
  postFixture,
} from '@itd-api/testing';
import {
  AttachmentType,
  type ClientPlugin,
  ItdClient,
  NotificationType,
  Paginator,
  type Post,
  type PublicProfile,
  type TelemetryBatch,
  type ViewTracker,
} from 'itd-api';
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  type HydratedComment,
  type HydratedPaginator,
  type HydratedPost,
  type HydratedProfile,
  type HydrateFlavor,
  hydrateClient,
} from '../src/index.js';

const seed = {
  users: [
    { id: 'user-alice', username: 'alice', displayName: 'Алиса' },
    { id: 'user-bob', username: 'bob', displayName: 'Боб' },
  ],
  posts: [
    { id: 'post-1', authorId: 'user-alice', content: 'Первая запись' },
    { id: 'post-2', authorId: 'user-alice', content: 'Вторая запись' },
  ],
  comments: [
    {
      id: 'comment-1',
      postId: 'post-1',
      authorId: 'user-alice',
      content: 'Первый комментарий',
    },
  ],
} as const;

function hydratedServerClient() {
  const server = createMockServer({ seed });
  const raw = new ItdClient(server.clientOptions({ as: 'bob' }));
  return { server, raw, itd: hydrateClient(raw) };
}

describe('hydrateClient', () => {
  it('возвращает один фасад и сохраняет цепочки методов клиента', () => {
    const raw = new ItdClient({ auth: 'test-token', retry: false, rateLimit: false });
    const first = hydrateClient(raw);
    const second = hydrateClient(raw);

    expect(first).toBe(second);
    expect(hydrateClient(first as unknown as ItdClient)).toBe(first);

    const plugin: ClientPlugin = { name: 'empty', install() {} };
    expect(first.use(plugin)).toBe(first);
    expect(raw.hasPlugin('empty')).toBe(true);
  });

  it('гидратирует вложенные модели и не меняет JSON', async () => {
    const reply = commentFixture({
      id: 'reply-1',
      replyTo: { id: 'user-bob', username: 'bob', displayName: 'Боб' },
    });
    const comment = commentFixture({ id: 'comment-1', replies: [reply] });
    const originalPost = postFixture({ id: 'post-original' });
    const source = postFixture({
      id: 'post-root',
      originalPost,
      comments: [comment],
      wallRecipient: originalPost.author,
      attachments: [
        {
          id: 'attachment-1',
          type: AttachmentType.Image,
          url: 'https://cdn.test/image.webp',
          mimeType: 'image/webp',
        },
      ],
    });
    const mock = createMockFetch();
    mock.get('/api/posts/post-root', apiResponse(source));

    const itd = hydrateClient(
      new ItdClient({
        baseUrl: 'https://mock.itd.test',
        fetch: mock.fetch,
        auth: 'test-token',
        retry: false,
        rateLimit: false,
      }),
    );
    const post = await itd.posts.get('post-root');

    expect(typeof post.like).toBe('function');
    expect(typeof post.author.get).toBe('function');
    expect(typeof post.wallRecipient?.follow).toBe('function');
    expect(typeof post.originalPost?.repost).toBe('function');
    expect(typeof post.comments?.[0]?.reply).toBe('function');
    expect(typeof post.comments?.[0]?.replies?.[0]?.replyTo?.posts).toBe('function');
    expect(post.attachments[0]?.isImage()).toBe(true);
    expect(post.attachments[0]?.isVideo()).toBe(false);
    expect(Object.keys(post)).not.toContain('like');
    expect(Object.keys(post.author)).not.toContain('follow');
    expect(JSON.parse(JSON.stringify(post))).toEqual(source);
  });

  it('выполняет действия через обычные ресурсы клиента', async () => {
    const { server, itd } = hydratedServerClient();
    const post = await itd.posts.get('post-1');

    await post.like();
    await post.author.follow();
    const profile = await post.author.get();
    const wall = await profile.posts({ limit: 1 });
    const created = await post.comment('Новый комментарий');
    const updated = await created.update('Исправленный комментарий');
    const reply = await updated.reply('Ответ');

    expect(server.snapshot().posts.find((item) => item.id === post.id)?.likedBy).toContain(
      'user-bob',
    );
    expect(server.snapshot().users.find((item) => item.id === 'user-bob')?.following).toContain(
      'user-alice',
    );
    expect(typeof profile.block).toBe('function');
    expect(typeof wall.items[0]?.remove).toBe('function');
    expect(updated.content).toBe('Исправленный комментарий');
    expect(typeof reply.restore).toBe('function');

    await reply.remove();
    const restored = await reply.restore();
    expect(restored.id).toBe(reply.id);

    const ownPost = await itd.posts.create({ content: 'Запись Боба' });
    await ownPost.remove();
    const restoredPost = await ownPost.restore();
    expect(restoredPost.id).toBe(ownPost.id);
    server.assertNoUnsupportedRequests();
  });

  it('гидратирует связанные сущности уведомлений из REST API', async () => {
    const server = createMockServer({
      seed: {
        ...seed,
        notifications: [
          {
            id: 'notification-1',
            userId: 'user-bob',
            type: NotificationType.PostComment,
            actorIds: ['user-alice'],
            entityId: 'comment-1',
            parentEntityId: 'post-1',
          },
        ],
      },
    });
    const itd = hydrateClient(new ItdClient(server.clientOptions({ as: 'bob' })));

    const page = await itd.notifications.list();
    const notification = page.items[0];
    const post = await notification?.getPost();
    const reply = await notification?.comment?.reply((builder) =>
      builder.content('Ответ из REST-уведомления').replyTo('user-alice'),
    );

    expect(post?.id).toBe('post-1');
    expect(typeof post?.like).toBe('function');
    expect(reply?.replyTo?.id).toBe('user-alice');
    expect(typeof notification?.actors[0]?.follow).toBe('function');
    server.assertNoUnsupportedRequests();
  });

  it('гидратирует страницы и все способы перебора Paginator', async () => {
    const { itd } = hydratedServerClient();

    const page = await itd.posts.list({ limit: 1 });
    expect(typeof page.items[0]?.like).toBe('function');

    const byNext = itd.posts.iterate({ limit: 1 });
    expect(byNext).toBeInstanceOf(Paginator);
    expect(typeof (await byNext.next())?.items[0]?.comment).toBe('function');

    const byPages = itd.posts.iterate({ limit: 1 });
    const firstPage = await byPages.pages().next();
    expect(typeof firstPage.value?.items[0]?.author.follow).toBe('function');

    const byIterator = itd.posts.iterate({ limit: 1 });
    const iterated: HydratedPost[] = [];
    for await (const post of byIterator) iterated.push(post);
    expect(iterated).toHaveLength(2);
    expect(iterated.every((post) => typeof post.pin === 'function')).toBe(true);

    const collected = await itd.posts.iterate({ limit: 1 }).collect();
    expect(collected).toHaveLength(2);
    expect(collected.every((post) => typeof post.author.posts === 'function')).toBe(true);
  });

  it('гидратирует сетевой ответ и ответ из кэша одинаково', async () => {
    const { server, raw } = hydratedServerClient();
    raw.use(cache({ ttl: 60_000, operations: ['posts.get'] }));
    const itd = hydrateClient(raw);

    const plain = await raw.posts.get('post-1');
    const first = await itd.posts.get('post-1');
    const second = await itd.posts.get('post-1');

    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(typeof first.like).toBe('function');
    expect(typeof second.author.get).toBe('function');
    expect('like' in plain).toBe(false);
    expect(server.requests.filter((request) => request.path === '/api/posts/post-1')).toHaveLength(
      1,
    );
  });

  it('поддерживает замороженные результаты плагинов', async () => {
    const mock = createMockFetch();
    mock.get('/api/posts/frozen', apiResponse(postFixture({ id: 'frozen' })));
    const raw = new ItdClient({
      baseUrl: 'https://mock.itd.test',
      fetch: mock.fetch,
      auth: 'test-token',
      retry: false,
      rateLimit: false,
    });
    raw.use({
      name: 'freeze',
      install({ operations }) {
        operations.use(async (request, next) => {
          const result = await next(request);
          Object.defineProperty(result, 'pluginMeta', { value: 'сохранено' });
          return Object.freeze(result);
        });
      },
    });

    const post = await hydrateClient(raw).posts.get('frozen');
    expect(Object.isFrozen(post)).toBe(false);
    expect(typeof post.like).toBe('function');
    expect((post as unknown as Post & { pluginMeta: string }).pluginMeta).toBe('сохранено');
  });

  it('гидратирует модель после преобразования crypto', async () => {
    const mock = createMockFetch();
    mock.get(
      '/api/posts/encrypted',
      apiResponse(postFixture({ id: 'encrypted', content: encodeInvisible('Скрытый текст') })),
    );
    const raw = new ItdClient({
      baseUrl: 'https://mock.itd.test',
      fetch: mock.fetch,
      auth: 'test-token',
      retry: false,
      rateLimit: false,
    });
    raw.use(crypt());

    const post = await hydrateClient(raw).posts.get('encrypted');
    expect(post.secret?.text).toBe('Скрытый текст');
    expect(typeof post.like).toBe('function');
  });

  it('привязывает одну модель к нужному клиенту', async () => {
    const shared = postFixture({ id: 'shared' });
    shared.originalPost = shared;
    const calls: string[] = [];
    const make = (name: string) => {
      const raw = new ItdClient({ auth: 'test-token', retry: false, rateLimit: false });
      raw.use({
        name: `shared-${name}`,
        install({ operations }) {
          operations.use(async (request) => {
            if (request.path.endsWith('/like')) {
              calls.push(name);
              return { liked: true, likesCount: 1 };
            }
            return shared;
          });
        },
      });
      return hydrateClient(raw);
    };

    const first = await make('first').posts.get('shared');
    const second = await make('second').posts.get('shared');
    expect(first.originalPost).toBe(first);
    expect(second.originalPost).toBe(second);
    expect(second).not.toBe(first);
    await first.like();
    await second.like();

    expect(calls).toEqual(['first', 'second']);
  });
});

describe('типы', () => {
  it('выводит гидратированные результаты без ручного приведения', () => {
    const check = async (client: HydrateFlavor<ItdClient>) => {
      const post = await client.posts.get('post-id');
      const profile = await post.author.get();
      const comments = await post.comment('Текст').then((value) => value.getReplies());
      const refreshed = await post.get({
        extensions: { cache: 'reload', crypto: { decrypt: false } },
      });

      expectTypeOf(post).toEqualTypeOf<HydratedPost>();
      expectTypeOf(refreshed).toEqualTypeOf<HydratedPost>();
      expectTypeOf(profile).toEqualTypeOf<HydratedProfile<PublicProfile>>();
      expectTypeOf(comments.items[0]).toEqualTypeOf<HydratedComment | undefined>();
      expectTypeOf(client.posts.iterate()).toEqualTypeOf<HydratedPaginator<Post>>();
      expectTypeOf(client.telemetry.startView({ vs: 'view' })).toEqualTypeOf<ViewTracker>();
      expectTypeOf(client.telemetry.batch()).toEqualTypeOf<TelemetryBatch>();
    };

    expectTypeOf(check).returns.toEqualTypeOf<Promise<void>>();
  });

  it('сохраняет дополнительные поля наследника клиента', () => {
    class AppClient extends ItdClient {
      readonly appName = 'example';
    }

    const client = hydrateClient(new AppClient());
    expectTypeOf(client.appName).toEqualTypeOf<string>();
    expect(client.appName).toBe('example');
  });

  it('не меняет типы обычного клиента', () => {
    const check = async (client: ItdClient) => {
      const post = await client.posts.get('post-id');
      expectTypeOf(post).toEqualTypeOf<Post>();
    };

    expectTypeOf(check).returns.toEqualTypeOf<Promise<void>>();
  });
});
