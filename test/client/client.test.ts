import { describe, expect, it, vi } from 'vitest';
import { post } from '../../src/builders/post.js';
import { createClient, ItdClient } from '../../src/client.js';
import {
  ItdAbortError,
  ItdConfigError,
  ItdNotFoundError,
  ItdStateError,
  ItdTimeoutError,
} from '../../src/core/errors.js';
import type {
  EventTransport,
  EventTransportContext,
  EventTransportFrame,
} from '../../src/events/transports/transport.js';
import type { ErrorContextHook, FileInput, RequestContext } from '../../src/index.js';
import type { ItdClientOptions } from '../../src/options.js';
import { TelemetryResource } from '../../src/resources/telemetry.js';
import { CaptchaType } from '../../src/types/enums.js';
import { makeJwt } from '../helpers/jwt.js';
import {
  createHangingFetch,
  createMockFetch,
  json,
  type MockHandler,
  noContent,
} from '../helpers/mock-fetch.js';

/** Поток, которым управляет тест: событие и обрыв приходят по команде. */
class TestStreamTransport implements EventTransport {
  readonly name = 'test';

  #context: EventTransportContext | undefined;
  #fail: ((error: unknown) => void) | undefined;

  connect(context: EventTransportContext): Promise<void> {
    this.#context = context;
    context.onOpen();

    return new Promise<void>((resolve, reject) => {
      this.#fail = reject;
      context.signal.addEventListener('abort', () => resolve(), { once: true });
    });
  }

  /** Отправляет событие так, будто оно пришло от сервера. */
  emit(event: EventTransportFrame): void {
    this.#context?.onEvent(event);
  }

  /** Обрывает соединение ошибкой. */
  fail(error: unknown): void {
    this.#fail?.(error);
  }
}

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

describe('граница низкоуровневого запроса', () => {
  it('разрешает вручную указать ID встроенной операции', async () => {
    const { itd, mock } = makeClient([json({ ok: true })]);

    await expect(
      itd.request({ operationId: 'posts.list', method: 'GET', path: '/api/manual-feed' }),
    ).resolves.toEqual({ ok: true });
    expect(mock.calls[0]?.url).toBe('https://itd.test/api/manual-feed');
  });

  it('общий timeout охватывает operation plugin до transport', async () => {
    const { itd, mock } = makeClient([], { timeout: 10 });
    itd.use({
      name: 'hanging-operation',
      install({ operations }) {
        operations.use(() => new Promise<never>(() => {}));
      },
    });

    await expect(itd.request({ method: 'GET', path: '/api/test' })).rejects.toThrow(
      ItdTimeoutError,
    );
    expect(mock.callCount).toBe(0);
  });

  it('передаёт operation plugin общий сигнал timeout и освобождает его операцию', async () => {
    const { itd, mock } = makeClient([], { timeout: 10, shutdownTimeout: 30 });
    let pluginSignal: AbortSignal | undefined;
    itd.use({
      name: 'abort-aware-operation',
      install({ operations }) {
        operations.use(
          (_request, _next, context) =>
            new Promise<never>((_resolve, reject) => {
              pluginSignal = context.signal;
              context.signal.addEventListener('abort', () => reject(context.signal.reason), {
                once: true,
              });
            }),
        );
      },
    });

    await expect(itd.request({ method: 'GET', path: '/api/test' })).rejects.toThrow(
      ItdTimeoutError,
    );

    expect(pluginSignal?.aborted).toBe(true);
    expect(mock.callCount).toBe(0);
    await expect(itd.dispose()).resolves.toBeUndefined();
  });

  it('общий timeout освобождает operation plugin при зависшем onRetry', async () => {
    const onRetry = vi.fn(() => new Promise<void>(() => {}));
    const { itd } = makeClient(() => json({}, { status: 500 }), {
      timeout: 10,
      shutdownTimeout: 30,
      retry: { attempts: 2, baseDelay: 0, jitter: 0 },
      hooks: { onRetry },
    });
    itd.use({
      name: 'pass-through',
      install({ operations }) {
        operations.use((request, next) => next(request));
      },
    });

    await expect(itd.request({ method: 'GET', path: '/api/test' })).rejects.toThrow(
      ItdTimeoutError,
    );
    expect(onRetry).toHaveBeenCalledOnce();
    await expect(itd.dispose()).resolves.toBeUndefined();
  });

  it('не классифицирует ошибку onRequest как сетевую и не повторяет запрос', async () => {
    const failure = new Error('onRequest failed');
    const onRequest = vi.fn((context: RequestContext) => {
      context.headers.set('X-Before-Failure', 'present');
      throw failure;
    });
    const onError = vi.fn();
    const { itd, mock } = makeClient(() => json({ data: {} }), {
      retry: { attempts: 3, baseDelay: 0, jitter: 0 },
      hooks: { onRequest, onError },
    });

    const actual = await itd
      .request({ method: 'GET', path: '/api/test' })
      .catch((error: unknown) => error);
    expect(onRequest).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0]?.[0].headers.get('x-before-failure')).toBe('present');
    expect(mock.callCount).toBe(0);
    expect(actual).toBe(failure);
  });

  it('не классифицирует ошибку onResponse как сетевую и не повторяет успешный ответ', async () => {
    const failure = new Error('onResponse failed');
    const onResponse = vi.fn(() => {
      throw failure;
    });
    const { itd, mock } = makeClient(() => json({ data: {} }), {
      retry: { attempts: 3, baseDelay: 0, jitter: 0 },
      hooks: { onResponse },
    });

    const actual = await itd
      .request({ method: 'GET', path: '/api/test' })
      .catch((error: unknown) => error);
    expect(onResponse).toHaveBeenCalledOnce();
    expect(mock.callCount).toBe(1);
    expect(actual).toBe(failure);
  });

  it('не маскирует ошибку подготовки JSON под сетевую и не повторяет её', async () => {
    const { itd, mock } = makeClient([], {
      retry: { attempts: 3, baseDelay: 0, jitter: 0 },
    });
    const body: Record<string, unknown> = {};
    body.self = body;

    await expect(itd.request({ method: 'GET', path: '/api/test', body })).rejects.toThrow(
      ItdConfigError,
    );
    expect(mock.callCount).toBe(0);
  });

  it('вызывает onError и для ошибки до входа в transport', async () => {
    const onError = vi.fn();
    const { itd, mock } = makeClient([], { hooks: { onError } });

    await expect(
      itd.request({ method: 'GET', path: '/api/test', service: 'missing' }),
    ).rejects.toThrow(ItdConfigError);

    expect(onError).toHaveBeenCalledOnce();
    expect(mock.callCount).toBe(0);
  });

  it('не подавляет onError другого запроса с тем же объектом ошибки', async () => {
    const failure = new Error('shared failure');
    const onError = vi.fn();
    const { itd } = makeClient([], { hooks: { onError } });
    itd.use({
      name: 'shared-error',
      install({ operations }) {
        operations.use(() => Promise.reject(failure));
      },
    });

    await expect(itd.request({ method: 'GET', path: '/api/first' })).rejects.toBe(failure);
    await expect(itd.request({ method: 'GET', path: '/api/second' })).rejects.toBe(failure);

    expect(onError).toHaveBeenCalledTimes(2);
  });

  it('сообщает новую ошибку retry после уже обработанной ошибки попытки', async () => {
    const retryFailure = new Error('retry hook failed');
    const onError = vi.fn();
    const { itd } = makeClient([json({}, { status: 500 })], {
      retry: { attempts: 2, baseDelay: 0, jitter: 0 },
      hooks: {
        onError,
        onRetry: () => {
          throw retryFailure;
        },
      },
    });

    await expect(itd.request({ method: 'GET', path: '/api/test' })).rejects.toBe(retryFailure);

    expect(onError).toHaveBeenCalledTimes(2);
    expect(onError.mock.calls[1]?.[0].error).toBe(retryFailure);
  });

  it('не удерживает timeout из-за зависшего onError', async () => {
    const { itd } = makeClient([], {
      timeout: 10,
      hooks: { onError: () => new Promise<void>(() => {}) },
    });
    itd.use({
      name: 'hanging-operation',
      install({ operations }) {
        operations.use(() => new Promise<never>(() => {}));
      },
    });

    await expect(itd.request({ method: 'GET', path: '/api/test' })).rejects.toThrow(
      ItdTimeoutError,
    );
  });

  it('освобождает operation plugin при зависшем onError транспортной ошибки', async () => {
    let hookSignal: AbortSignal | undefined;
    const onError = vi.fn((context: ErrorContextHook) => {
      hookSignal = context.signal;
      return new Promise<void>(() => {});
    });
    const { itd } = makeClient(() => json({}, { status: 500 }), {
      timeout: 10,
      shutdownTimeout: 30,
      retry: false,
      hooks: { onError },
    });
    itd.use({
      name: 'pass-through',
      install({ operations }) {
        operations.use((request, next) => next(request));
      },
    });

    await expect(itd.request({ method: 'GET', path: '/api/test' })).rejects.toThrow(
      ItdTimeoutError,
    );
    expect(onError).toHaveBeenCalledOnce();
    expect(hookSignal?.aborted).toBe(true);
    await expect(itd.dispose()).resolves.toBeUndefined();
  });
});

/** Ответ ленты в том виде, в каком его отдаёт сервер. */
function feedPage(ids: string[], nextCursor: string | null) {
  return json({
    data: {
      posts: ids.map((id) => ({ id, content: `пост ${id}` })),
      pagination: { limit: 20, nextCursor, hasMore: nextCursor !== null },
    },
  });
}

describe('посты', () => {
  it('загружает ленту и снимает обёртку', async () => {
    const { itd, mock } = makeClient([feedPage(['1', '2'], '2')]);

    const page = await itd.posts.list({ tab: 'popular', limit: 20 });

    expect(page.items.map((p) => p.id)).toEqual(['1', '2']);
    expect(page.nextCursor).toBe('2');
    expect(mock.calls[0]?.url).toBe('https://itd.test/api/posts?tab=popular&limit=20');
  });

  it('перебирает ленту, подставляя курсоры', async () => {
    const { itd, mock } = makeClient([
      feedPage(['1'], '2'),
      feedPage(['2'], '2026-07-21T10:00:00Z'),
      feedPage(['3'], null),
    ]);

    const ids: string[] = [];
    for await (const post of itd.posts.iterate({ tab: 'following' })) ids.push(post.id);

    expect(ids).toEqual(['1', '2', '3']);
    expect(mock.calls[1]?.url).toContain('cursor=2');
    expect(mock.calls[2]?.url).toContain('cursor=2026-07-21T10%3A00%3A00Z');
  });

  it('collect ограничивает выборку', async () => {
    const { itd } = makeClient([feedPage(['1', '2', '3'], '2'), feedPage(['4', '5'], '3')]);

    const posts = await itd.posts.iterate({ tab: 'popular' }).collect(4);

    expect(posts).toHaveLength(4);
  });

  it('берёт maxPages из PaginationOptions, отдельно от параметров endpoint', async () => {
    const { itd, mock } = makeClient([
      feedPage(['1'], '2'),
      feedPage(['2'], '3'),
      feedPage(['3'], null),
    ]);

    const posts = await itd.posts.iterate({ tab: 'popular' }, { maxPages: 2 }).collect();

    expect(posts.map((post) => post.id)).toEqual(['1', '2']);
    expect(mock.callCount).toBe(2);
    expect(mock.calls[0]?.url).not.toContain('maxPages');
  });

  it('не передаёт maxPages operation transformers как опцию запроса endpoint', async () => {
    const { itd } = makeClient([feedPage(['1'], 'next'), feedPage(['2'], 'still-more')]);
    const seen: Array<boolean> = [];
    itd.use({
      name: 'pagination-options-observer',
      install({ operations }) {
        operations.use((request, next) => {
          if (request.operationId === 'posts.list') seen.push('maxPages' in request);
          return next(request);
        });
      },
    });

    await itd.posts.iterate({}, { maxPages: 2 }).collect();

    expect(seen).toEqual([false, false]);
  });

  it('публикует пост', async () => {
    const { itd, mock } = makeClient([json({ id: 'p1', content: 'привет' })]);

    const post = await itd.posts.create({ content: 'привет' });

    expect(post.id).toBe('p1');
    expect(JSON.parse(mock.calls[0]?.body ?? '{}')).toEqual({ content: 'привет' });
  });

  it('принимает билдер и функцию-настройщик', async () => {
    const { itd, mock } = makeClient(() => json({ id: 'p1' }));

    await itd.posts.create((p) => p.content('раз'));
    await itd.posts.create({ content: 'два' });

    expect(JSON.parse(mock.calls[0]?.body ?? '{}').content).toBe('раз');
    expect(JSON.parse(mock.calls[1]?.body ?? '{}').content).toBe('два');
  });

  it('прикладывает опрос', async () => {
    const { itd, mock } = makeClient([json({ id: 'p1' })]);

    await itd.posts.create((p) =>
      p.content('голосуем').poll((q) => q.question('ну как?').options('да', 'нет')),
    );

    // multipleChoice отправляется всегда — без него сервер отвергает запрос.
    expect(JSON.parse(mock.calls[0]?.body ?? '{}').poll).toEqual({
      question: 'ну как?',
      options: [{ text: 'да' }, { text: 'нет' }],
      multipleChoice: false,
    });
  });

  it('не отправляет запрос, если пост не прошёл проверку', async () => {
    const { itd, mock } = makeClient([]);

    await expect(itd.posts.create({ content: '   ' })).rejects.toThrow(ItdConfigError);
    expect(mock.callCount).toBe(0);
  });

  it('реакции и репосты', async () => {
    const { itd, mock } = makeClient(() => json({ liked: true, likesCount: 1 }));

    await itd.posts.like('p1');
    await itd.posts.unlike('p1');
    await itd.posts.pin('p1');

    expect(mock.calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual([
      'POST /api/posts/p1/like',
      'DELETE /api/posts/p1/like',
      'POST /api/posts/p1/pin',
    ]);
  });

  it('читает комментарии с курсором на верхнем уровне', async () => {
    const { itd } = makeClient([
      json({ data: { comments: [{ id: 'c1' }], total: 5, hasMore: true, nextCursor: '2' } }),
    ]);

    const page = await itd.posts.comments('p1');

    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBe('2');
    expect(page.total).toBe(5);
  });

  it('комментирует пост строкой', async () => {
    const { itd, mock } = makeClient([json({ id: 'c1' })]);

    await itd.posts.comment('p1', 'согласен');

    expect(JSON.parse(mock.calls[0]?.body ?? '{}')).toEqual({
      content: 'согласен',
      attachmentIds: [],
    });
  });

  it('обновляет пост через тот же билдер текста, что и create', async () => {
    const { itd, mock } = makeClient([json({ id: 'p1' })]);

    await itd.posts.update(
      'p1',
      post().markup((m) => m.bold('важно').text(' ').hashtag('новости')),
    );

    expect(JSON.parse(mock.calls[0]?.body ?? '{}')).toEqual({
      content: 'важно #новости',
      spans: [
        { type: 'bold', offset: 0, length: 5 },
        { type: 'hashtag', offset: 6, length: 8, tag: 'новости' },
      ],
    });
  });

  it('не отправляет update без явно заданного content', () => {
    const { itd, mock } = makeClient([]);

    expect(() => itd.posts.update('p1', {} as never)).toThrow(/требует явно заданный content/);
    expect(mock.callCount).toBe(0);
  });

  it('передаёт явно заданный пустой content без подстановок', async () => {
    const { itd, mock } = makeClient([json({ id: 'p1' })]);

    await itd.posts.update('p1', post(''));

    expect(JSON.parse(mock.calls[0]?.body ?? '{}')).toEqual({ content: '' });
  });
});

describe('загрузка файлов', () => {
  it('перебор постов продолжается с переданного курсора', async () => {
    const { itd, mock } = makeClient([feedPage(['1'], null)]);

    await itd.posts.iterate({ cursor: 'сохранённый' }).collect();

    // Раньше стартовый курсор терялся и перебор молча начинался сначала.
    expect(mock.calls[0]?.url).toContain('cursor=%D1%81%D0%BE%D1%85%D1%80');
  });

  it('сначала грузит файлы, потом публикует пост', async () => {
    const { itd, mock } = makeClient((request) =>
      request.url.includes('/files/upload')
        ? json({ id: `att-${mock.callCount}`, url: 'https://cdn/x' })
        : json({ id: 'p1' }),
    );

    await itd.posts.create((p) =>
      p.content('смотрите').attach(new Blob(['a'], { type: 'image/png' })),
    );

    expect(mock.calls[0]?.url).toContain('/api/files/upload');
    expect(mock.calls[1]?.url).toContain('/api/posts');
    expect(JSON.parse(mock.calls[1]?.body ?? '{}').attachmentIds).toEqual(['att-1']);
  });

  it('сохраняет порядок вложений', async () => {
    let uploaded = 0;
    const { itd, mock } = makeClient((request) =>
      request.url.includes('/files/upload')
        ? json({ id: `att-${++uploaded}`, url: 'https://cdn/x' })
        : json({ id: 'p1' }),
    );

    await itd.posts.create((p) =>
      p
        .content('три файла')
        .attach(new Blob(['1'], { type: 'image/png' }))
        .attach(new Blob(['2'], { type: 'image/jpeg' }))
        .attach(new Blob(['3'], { type: 'image/webp' })),
    );

    const body = JSON.parse(mock.calls[3]?.body ?? '{}');
    expect(body.attachmentIds).toEqual(['att-1', 'att-2', 'att-3']);
  });

  it('объединяет готовые вложения с загруженными', async () => {
    const { itd, mock } = makeClient((request) =>
      request.url.includes('/files/upload') ? json({ id: 'att-new' }) : json({ id: 'p1' }),
    );

    await itd.posts.create((p) =>
      p
        .content('т')
        .attachId('att-old')
        .attach(new Blob(['1'], { type: 'image/png' })),
    );

    expect(JSON.parse(mock.calls[1]?.body ?? '{}').attachmentIds).toEqual(['att-old', 'att-new']);
  });

  it('отвергает неподдерживаемый тип до обращения к сети', async () => {
    const { itd, mock } = makeClient([]);

    await expect(
      itd.files.upload(new Blob(['x'], { type: 'application/pdf' }), { filename: 'a.pdf' }),
    ).rejects.toThrow(/не поддерживается/);
    expect(mock.callCount).toBe(0);
  });

  it('определяет тип по расширению имени файла', async () => {
    const { itd, mock } = makeClient([json({ id: 'att-1', url: 'https://cdn/x' })]);

    await itd.files.upload(new Blob(['x']), { filename: 'photo.jpg' });

    expect(mock.callCount).toBe(1);
  });

  it('подсказывает fromPath, когда путь передан строкой', async () => {
    const { itd } = makeClient([]);

    await expect(
      itd.posts.create((p) => p.content('т').attach('./a.png' as unknown as FileInput)),
    ).rejects.toThrow(/itd-api\/node/);
  });

  it('validateMime: false пропускает проверку', async () => {
    const { itd, mock } = makeClient([json({ id: 'att-1' })]);

    await itd.files.upload(new Blob(['x'], { type: 'application/pdf' }), {
      filename: 'a.pdf',
      validateMime: false,
    });

    expect(mock.callCount).toBe(1);
  });
});

describe('пользователи', () => {
  it('загружает свой профиль', async () => {
    const { itd, mock } = makeClient([json({ id: 'u1', username: 'me' })]);

    expect((await itd.users.me()).username).toBe('me');
    expect(mock.calls[0]?.url).toBe('https://itd.test/api/users/me');
  });

  it('обновляет баннер по идентификатору файла', async () => {
    const { itd, mock } = makeClient([json({ id: 'u1', banner: 'https://cdn/banner-1.webp' })]);

    await itd.users.updateMe({ bannerId: 'banner-1' });

    expect(mock.calls[0]?.method).toBe('PUT');
    expect(mock.calls[0]?.url).toBe('https://itd.test/api/users/me');
    expect(JSON.parse(mock.calls[0]?.body ?? '{}')).toEqual({ bannerId: 'banner-1' });
  });

  it('загружает файл перед установкой баннера', async () => {
    const { itd, mock } = makeClient((request) =>
      request.url.includes('/files/upload')
        ? json({ id: 'banner-2', url: 'https://cdn/banner.webp' })
        : json({ id: 'u1', banner: 'https://cdn/banner.webp' }),
    );

    await itd.users.setBanner(new Blob(['image'], { type: 'image/webp' }), {
      filename: 'banner.webp',
    });

    expect(mock.calls.map((call) => `${call.method} ${new URL(call.url).pathname}`)).toEqual([
      'POST /api/files/upload',
      'PUT /api/users/me',
    ]);
    expect(JSON.parse(mock.calls[1]?.body ?? '{}')).toEqual({ bannerId: 'banner-2' });
  });

  it('удаляет баннер через bannerId: null', async () => {
    const { itd, mock } = makeClient([json({ id: 'u1', banner: null })]);

    await itd.users.removeBanner();

    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0]?.method).toBe('PUT');
    expect(mock.calls[0]?.url).toBe('https://itd.test/api/users/me');
    expect(JSON.parse(mock.calls[0]?.body ?? '{}')).toEqual({ bannerId: null });
  });

  it('принимает имя пользователя вместо идентификатора', async () => {
    const { itd, mock } = makeClient([json({ id: 'u1', username: 'nowkie' })]);

    await itd.users.get('nowkie');

    expect(mock.calls[0]?.url).toBe('https://itd.test/api/users/nowkie');
  });

  it('перебирает подписчиков постранично', async () => {
    const page = (users: string[], hasMore: boolean, page: number) =>
      json({
        data: { users: users.map((id) => ({ id })), pagination: { page, total: 3, hasMore } },
      });

    const { itd, mock } = makeClient([page(['1', '2'], true, 1), page(['3'], false, 2)]);

    const all = await itd.users.iterateFollowers('nowkie').collect();

    expect(all).toHaveLength(3);
    expect(mock.calls[1]?.url).toContain('page=2');
  });

  it('читает признак доступности имени', async () => {
    const { itd } = makeClient([json({ available: true })]);

    expect(await itd.users.checkUsername('новое_имя')).toBe(true);
  });

  it('читает активный значок как строку', async () => {
    const { itd } = makeClient([json({ data: { pins: [{ slug: 'a' }], activePin: 'a' } })]);

    const result = await itd.users.pins();

    expect(result.activePin).toBe('a');
    expect(result.pins).toHaveLength(1);
  });
});

describe('комментарии', () => {
  it('отвечает с указанием адресата', async () => {
    const { itd, mock } = makeClient([json({ id: 'c2' })]);

    await itd.comments.reply('c1', (c) => c.content('и вот почему').replyTo('u1'));

    expect(JSON.parse(mock.calls[0]?.body ?? '{}')).toEqual({
      content: 'и вот почему',
      attachmentIds: [],
      replyToUserId: 'u1',
    });
  });

  it('перебирает ответы постранично', async () => {
    const page = (ids: string[], hasMore: boolean) =>
      json({ data: { replies: ids.map((id) => ({ id })), pagination: { hasMore } } });

    const { itd } = makeClient([page(['c1'], true), page(['c2'], false)]);

    expect(await itd.comments.iterateReplies('c0').collect()).toHaveLength(2);
  });
});

describe('авторизация', () => {
  it('получает выбранный сервером captcha-провайдер', async () => {
    const { itd, mock } = makeClient([json({ provider: 'itd', field: 'token' })], {
      auth: undefined,
    });

    await expect(itd.auth.captchaProvider()).resolves.toEqual({ provider: 'itd', field: 'token' });
    expect(mock.calls[0]?.method).toBe('GET');
    expect(mock.calls[0]?.url).toBe('https://itd.test/api/v1/auth/captcha/provider');
    expect(mock.calls[0]?.headers.get('authorization')).toBeNull();
  });

  it('создаёт QR-вход и проверяет его состояние', async () => {
    const started = {
      qrId: 'qr-1',
      claimToken: 'claim-1',
      payload: 'itd://login/qr-1',
      expiresIn: 120,
      captchaRequired: false,
    };
    const { itd, mock } = makeClient([json(started), json({ status: 'scanned', expiresIn: 90 })], {
      auth: undefined,
    });

    await expect(itd.auth.startQrLogin()).resolves.toEqual(started);
    await expect(
      itd.auth.claimQrLogin({ qrId: started.qrId, claimToken: started.claimToken }),
    ).resolves.toEqual({ status: 'scanned', expiresIn: 90 });

    expect(mock.calls.map((call) => `${call.method} ${new URL(call.url).pathname}`)).toEqual([
      'POST /api/v1/auth/qr/start',
      'POST /api/v1/auth/qr/claim',
    ]);
    expect(JSON.parse(mock.calls[1]?.body ?? '{}')).toEqual({
      qrId: 'qr-1',
      claimToken: 'claim-1',
    });
  });

  it('сохраняет accessToken, полученный через QR-вход', async () => {
    const { itd, mock } = makeClient(
      [json({ status: 'authorized', accessToken: 'qr-token' }), json({ id: 'u1' })],
      { auth: undefined },
    );

    await expect(
      itd.auth.claimQrLogin({
        qrId: 'qr-1',
        claimToken: 'claim-1',
        captcha: { type: CaptchaType.Itd, token: 'captcha-token' },
      }),
    ).resolves.toEqual({ status: 'authorized', accessToken: 'qr-token' });

    await itd.users.me();
    expect(mock.calls[1]?.headers.get('authorization')).toBe('Bearer qr-token');
    expect(JSON.parse(mock.calls[0]?.body ?? '{}')).toMatchObject({ token: 'captcha-token' });
  });

  it('добывает токен капчи QR-входа только после отказа сервера', async () => {
    const getToken = vi.fn().mockResolvedValue('свежая');
    const { itd, mock } = makeClient(
      [
        json({ status: 'captcha_required', expiresIn: 100 }),
        json({ provider: 'itd', field: 'token' }),
        json({ status: 'authorized', accessToken: 'qr-token' }),
      ],
      { auth: undefined, captcha: { getToken } },
    );

    await itd.auth.claimQrLogin({ qrId: 'qr-c', claimToken: 'claim-c' });

    // Опрос статуса идёт в цикле: решать капчу до просьбы сервера значило бы поднимать
    // браузер на каждую проверку.
    expect(getToken).not.toHaveBeenCalled();

    await itd.auth.claimQrLogin({ qrId: 'qr-c', claimToken: 'claim-c' });

    expect(JSON.parse(mock.calls[2]?.body ?? '{}')).toEqual({
      qrId: 'qr-c',
      claimToken: 'claim-c',
      token: 'свежая',
    });
  });

  it.each(['pending', 'scanned', 'captcha_required', 'rejected'] as const)(
    'возвращает промежуточный статус QR claim: %s',
    async (status) => {
      const result = { status, expiresIn: 60 };
      const { itd } = makeClient([json(result)], { auth: undefined });

      await expect(
        itd.auth.claimQrLogin({ qrId: 'qr-status', claimToken: 'claim-status' }),
      ).resolves.toEqual(result);
    },
  );

  it('не стирает refresh-cookie активной сессии при запуске QR-входа', async () => {
    const started = {
      qrId: 'qr-session',
      claimToken: 'claim-session',
      payload: 'itd://login/qr-session',
      expiresIn: 120,
      captchaRequired: false,
    };
    const { itd, mock } = makeClient([json(started), json({ accessToken: 'refreshed' })], {
      auth: { accessToken: 'old', refreshToken: 'live-refresh' },
    });

    await itd.auth.startQrLogin();
    await itd.auth.refresh();

    expect(mock.calls[1]?.headers.get('cookie')).toContain('refresh_token=live-refresh');
  });

  it('переносит только cookie QR-потока из start в claim', async () => {
    const started = {
      qrId: 'qr-cookie',
      claimToken: 'claim-cookie',
      payload: 'itd://login/qr-cookie',
      expiresIn: 120,
      captchaRequired: false,
    };
    const { itd, mock } = makeClient(
      [
        json(started, { headers: { 'set-cookie': 'qr_flow=flow-1; Path=/api/v1/auth' } }),
        json({ status: 'pending', expiresIn: 110 }),
      ],
      { auth: { accessToken: 'old', refreshToken: 'live-refresh' } },
    );

    await itd.auth.startQrLogin();
    await itd.auth.claimQrLogin({ qrId: started.qrId, claimToken: started.claimToken });

    expect(mock.calls[1]?.headers.get('cookie')).toContain('qr_flow=flow-1');
    expect(mock.calls[1]?.headers.get('cookie')).not.toContain('live-refresh');
  });

  it('принимает refresh-cookie авторизованного QR-потока', async () => {
    const { itd } = makeClient(
      [
        json(
          { status: 'authorized', accessToken: 'qr-access' },
          { headers: { 'set-cookie': 'refresh_token=qr-refresh; Path=/api/v1/auth' } },
        ),
      ],
      { auth: { accessToken: 'old', refreshToken: 'old-refresh' } },
    );

    await itd.auth.claimQrLogin({ qrId: 'qr-new', claimToken: 'claim-new' });

    const cookies = (await itd.getSession())?.cookies ?? [];
    expect(cookies.some((cookie) => cookie.includes('refresh_token=qr-refresh'))).toBe(true);
    expect(cookies.some((cookie) => cookie.includes('old-refresh'))).toBe(false);
  });

  it('не повторяет одноразовый QR claim после ошибки сервера', async () => {
    const { itd, mock } = makeClient(
      () => json({ error: { code: 'UNKNOWN_ERROR' } }, { status: 500 }),
      {
        auth: undefined,
        retry: { attempts: 2, baseDelay: 0, jitter: 0 },
      },
    );

    await expect(
      itd.auth.claimQrLogin({ qrId: 'qr-once', claimToken: 'claim-once' }),
    ).rejects.toMatchObject({ status: 500 });
    expect(mock.callCount).toBe(1);
  });

  it('доставляет события короткого QR stream', async () => {
    const response = new Response(
      'data: {"status":"scanned","expiresIn":120}\n\n' +
        'event: message\r\ndata: {"status":"approved","expiresIn":120}\r\n\r\n',
      { headers: { 'content-type': 'text/event-stream' } },
    );
    const { itd, mock } = makeClient([response], { auth: undefined });
    const events: unknown[] = [];

    await itd.auth.streamQrLogin({ qrId: 'qr-stream', claimToken: 'claim-stream' }, (event) => {
      events.push(event);
    });

    expect(events).toEqual([
      { status: 'scanned', expiresIn: 120 },
      { status: 'approved', expiresIn: 120 },
    ]);
    expect(mock.calls[0]).toMatchObject({ method: 'POST', credentials: 'include' });
    expect(mock.calls[0]?.url).toBe('https://itd.test/api/v1/auth/qr/stream');
    expect(JSON.parse(mock.calls[0]?.body ?? '{}')).toEqual({
      qrId: 'qr-stream',
      claimToken: 'claim-stream',
    });
  });

  it('переносит cookie QR-сессии из start в stream', async () => {
    const event = () =>
      new Response('data: {"status":"pending","expiresIn":90}\n\n', {
        headers: { 'content-type': 'text/event-stream' },
      });
    const started = {
      qrId: 'qr-policy',
      claimToken: 'claim-policy',
      payload: 'itd://login/qr-policy',
      expiresIn: 90,
      captchaRequired: false,
    };
    const server = makeClient(
      [json(started, { headers: { 'set-cookie': 'qr_flow=flow-1; Path=/api/v1/auth' } }), event()],
      { auth: undefined },
    );

    await server.itd.auth.startQrLogin();
    const input = { qrId: started.qrId, claimToken: started.claimToken };
    await server.itd.auth.streamQrLogin(input, () => {});

    expect(server.mock.calls[1]?.headers.get('cookie')).toContain('qr_flow=flow-1');
  });

  it('отменяет открытый QR stream по signal', async () => {
    const response = new Response(new ReadableStream<Uint8Array>({ start() {} }), {
      headers: { 'content-type': 'text/event-stream' },
    });
    const { itd } = makeClient([response], { auth: undefined });
    const controller = new AbortController();
    const pending = itd.auth.streamQrLogin(
      { qrId: 'qr-stream', claimToken: 'claim-stream' },
      () => {},
      { signal: controller.signal },
    );

    controller.abort();

    await expect(pending).rejects.toBeInstanceOf(ItdAbortError);
  });

  it('не открывает QR stream после dispose клиента', async () => {
    const { itd, mock } = makeClient([], { auth: undefined });
    const auth = itd.auth;
    await itd.dispose();

    await expect(
      auth.streamQrLogin({ qrId: 'qr-stream', claimToken: 'claim-stream' }, () => {}),
    ).rejects.toBeInstanceOf(ItdStateError);
    expect(mock.callCount).toBe(0);
  });

  it('проверяет состояние авторизации без обязательного токена', async () => {
    const { itd, mock } = makeClient([json({ authenticated: false, banned: false, user: null })], {
      auth: undefined,
    });

    await expect(itd.auth.check()).resolves.toEqual({
      authenticated: false,
      banned: false,
      user: null,
    });
    expect(mock.calls[0]?.method).toBe('GET');
    expect(mock.calls[0]?.url).toBe('https://itd.test/api/profile');
    expect(mock.calls[0]?.headers.get('authorization')).toBeNull();
  });

  it('сохраняет токен после входа', async () => {
    const { itd, mock } = makeClient([json({ accessToken: 'signed-in' }), json({ id: 'u1' })], {
      auth: undefined,
    });

    const result = await itd.auth.signIn({
      email: 'a@b.c',
      password: 'p',
      captcha: { type: CaptchaType.Cloudflare, token: 'cap' },
    });

    expect(result).toEqual({ status: 'authenticated', accessToken: 'signed-in' });
    await itd.users.me();
    expect(mock.calls[1]?.headers.get('authorization')).toBe('Bearer signed-in');
  });

  it('берёт токен капчи входа из опции клиента', async () => {
    const getToken = vi.fn().mockResolvedValue('свежая');
    const { itd, mock } = makeClient(
      [json({ provider: 'cloudflare', field: 'turnstileToken' }), json({ accessToken: 'in' })],
      { auth: undefined, captcha: { getToken } },
    );

    await itd.auth.signIn({ email: 'a@b.c', password: 'p' });

    expect(getToken).toHaveBeenCalledExactlyOnceWith(CaptchaType.Cloudflare);
    expect(JSON.parse(mock.calls[1]?.body ?? '{}')).toEqual({
      email: 'a@b.c',
      password: 'p',
      turnstileToken: 'свежая',
    });
  });

  it('токен из вызова важнее источника', async () => {
    const getToken = vi.fn();
    const { itd, mock } = makeClient([json({ accessToken: 'in' })], {
      auth: undefined,
      captcha: { getToken },
    });

    await itd.auth.signIn({
      email: 'a@b.c',
      password: 'p',
      captcha: { type: CaptchaType.Itd, token: 'своя' },
    });

    expect(getToken).not.toHaveBeenCalled();
    expect(JSON.parse(mock.calls[0]?.body ?? '{}').token).toBe('своя');
  });

  it('добывает токен капчи для регистрации и сброса пароля', async () => {
    const getToken = vi.fn().mockResolvedValue('свежая');
    const { itd, mock } = makeClient(
      [
        json({ provider: 'itd', field: 'token' }),
        json({ flowToken: 'signup' }),
        json({ provider: 'itd', field: 'token' }),
        json({ flowToken: 'reset' }),
      ],
      { auth: undefined, captcha: { getToken } },
    );

    await itd.auth.signUp({ email: 'a@b.c', password: 'p' });
    await itd.auth.forgotPassword({ email: 'a@b.c' });

    expect(JSON.parse(mock.calls[1]?.body ?? '{}').token).toBe('свежая');
    expect(JSON.parse(mock.calls[3]?.body ?? '{}')).toEqual({
      email: 'a@b.c',
      token: 'свежая',
    });
  });

  it('без источника и токена отправляет вход как есть', async () => {
    const { itd, mock } = makeClient([json({ accessToken: 'in' })], { auth: undefined });

    await itd.auth.signIn({ email: 'a@b.c', password: 'p' });

    expect(mock.calls.some((call) => call.url.endsWith('/captcha/provider'))).toBe(false);
    expect(JSON.parse(mock.calls[0]?.body ?? '{}')).toEqual({ email: 'a@b.c', password: 'p' });
  });

  it('сообщает о требовании кода подтверждения', async () => {
    const { itd } = makeClient([json({ flowToken: 'flow-1' })], { auth: undefined });

    expect(
      await itd.auth.signIn({
        email: 'a@b.c',
        password: 'p',
        captcha: { type: CaptchaType.Cloudflare, token: 'cap' },
      }),
    ).toEqual({ status: 'otp_required', flowToken: 'flow-1' });
  });

  it('проходит полный вход с кодом', async () => {
    const { itd, mock } = makeClient(
      [json({ flowToken: 'flow-1' }), json({ accessToken: 'verified' })],
      { auth: undefined },
    );

    const token = await itd.auth.signInWithOtp({
      email: 'a@b.c',
      password: 'p',
      captcha: { type: CaptchaType.Cloudflare, token: 'cap' },
      getOtp: () => '123456',
    });

    expect(token).toBe('verified');
    expect(JSON.parse(mock.calls[1]?.body ?? '{}')).toMatchObject({
      otp: '123456',
      flowToken: 'flow-1',
    });
  });

  it('очищает сессию при выходе, но помнит устройство', async () => {
    const { itd } = makeClient([noContent()]);

    await itd.auth.logout();

    const session = await itd.getSession();
    expect(session?.accessToken).toBeUndefined();
    // Идентификатор устройства выход переживает — иначе каждый вход плодил бы новую сессию.
    expect(session?.deviceId).toEqual(expect.any(String));
  });

  it('сообщает о получении токена', async () => {
    const { itd } = makeClient([json({ accessToken: 'новый' })], { auth: undefined });
    const onTokens = vi.fn();
    itd.on('tokens', onTokens);

    await itd.auth.signIn({
      email: 'a@b.c',
      password: 'p',
      captcha: { type: CaptchaType.Cloudflare, token: 'cap' },
    });

    expect(onTokens).toHaveBeenCalledWith({ accessToken: 'новый' });
  });

  it('читает список сессий', async () => {
    const { itd } = makeClient([json({ sessions: [{ id: 's1', isCurrent: true }] })]);

    expect(await itd.auth.sessions()).toHaveLength(1);
  });

  it('завершает все сессии отзывом и выходом', async () => {
    const { itd, mock } = makeClient([noContent(), noContent()]);

    await itd.auth.logoutAll();

    // Единого logout-all на сервере нет, поэтому вызов собран из двух запросов.
    expect(mock.calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual([
      'DELETE /api/v1/auth/sessions',
      'POST /api/v1/auth/logout',
    ]);
  });

  it('сбрасывает пароль кодом из письма', async () => {
    const { itd, mock } = makeClient([json({ flowToken: 'flow-1' }), noContent()], {
      auth: undefined,
    });

    await itd.auth.resetPasswordWithOtp({
      email: 'a@b.c',
      captcha: { type: CaptchaType.Cloudflare, token: 'cap' },
      newPassword: 'Xx12345678!',
      getOtp: () => '123456',
    });

    expect(JSON.parse(mock.calls[0]?.body ?? '{}')).toEqual({
      email: 'a@b.c',
      turnstileToken: 'cap',
    });
    expect(JSON.parse(mock.calls[1]?.body ?? '{}')).toEqual({
      email: 'a@b.c',
      otp: '123456',
      flowToken: 'flow-1',
      newPassword: 'Xx12345678!',
    });
  });
});

describe('очередь и авторизация', () => {
  /**
   * Очередь охватывает только одну транспортную попытку. Поэтому ответ `401` сначала
   * освобождает слот, а затем refresh может безопасно войти в ту же очередь.
   */
  function makeExpiring(rateLimit: ItdClientOptions['rateLimit']) {
    let refreshes = 0;
    const { itd, mock } = makeClient(
      (request) => {
        if (request.url.endsWith('/refresh')) {
          refreshes += 1;
          return json({ accessToken: 'refreshed' });
        }
        return request.headers.get('authorization') === 'Bearer refreshed'
          ? json({ data: { ok: true } })
          : json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 });
      },
      { auth: { accessToken: 'expired', refreshToken: 'rt' }, rateLimit },
    );

    return { itd, mock, refreshes: () => refreshes };
  }

  it('продление входит в очередь после освобождения слота исходной попыткой', async () => {
    const { itd, refreshes } = makeExpiring({ concurrency: 1 });
    const refreshQueueFlags: Array<boolean | undefined> = [];
    itd.use({
      name: 'auth-request-observer',
      install({ operations }) {
        operations.use(async (request, next) => {
          if (request.path.endsWith('/refresh')) refreshQueueFlags.push(request.skipQueue);
          return next(request);
        });
      },
    });

    await expect(itd.users.me()).resolves.toEqual({ ok: true });
    expect(refreshes()).toBe(1);
    expect(refreshQueueFlags).toEqual([undefined]);
  });

  it('нумерует фактические попытки исходной операции вокруг отдельного refresh', async () => {
    const { itd } = makeExpiring(false);
    const attempts: string[] = [];
    itd.use({
      name: 'attempt-observer',
      install({ attempts: pipeline }) {
        pipeline.use(async ({ operationId, attempt }, next) => {
          attempts.push(`${operationId}:${attempt}`);
          return next();
        });
      },
    });

    await itd.users.me();

    expect(attempts).toEqual(['users.me:1', 'auth.refresh:1', 'users.me:2']);
  });

  it('одновременные 401 освобождают слоты и используют один refresh', async () => {
    const { itd, refreshes } = makeExpiring({ concurrency: 3 });

    const all = await Promise.all(Array.from({ length: 3 }, () => itd.users.me()));

    expect(all).toHaveLength(3);
    expect(refreshes()).toBe(1);
  });

  it('отложенный вход проходит через общий pipeline без deadlock', async () => {
    const { itd, mock } = makeClient(
      (request) => {
        if (request.url.endsWith('/captcha/provider')) {
          return json({ provider: 'cloudflare', field: 'turnstileToken' });
        }
        return request.url.endsWith('/sign-in')
          ? json({ accessToken: 'at' })
          : json({ data: { ok: true } });
      },
      {
        auth: { email: 'a@b.c', password: 'p' },
        captcha: () => 'cap',
        rateLimit: { concurrency: 1 },
      },
    );

    await expect(itd.users.me()).resolves.toEqual({ ok: true });
    expect(mock.calls.map((call) => call.url)).toEqual([
      expect.stringContaining('/captcha/provider'),
      expect.stringContaining('/sign-in'),
      expect.stringContaining('/users/me'),
    ]);
  });
});

describe('границы очереди', () => {
  it('локальный результат плагина не ждёт занятую транспортную очередь', async () => {
    let releaseSlow!: () => void;
    const { itd, mock } = makeClient(
      () =>
        new Promise<Response>((resolve) => {
          releaseSlow = () => resolve(json({ data: { slow: true } }));
        }),
      { rateLimit: { concurrency: 1 }, timeout: 0 },
    );
    itd.use({
      name: 'local-result',
      install({ operations }) {
        operations.use((request, next) =>
          request.path === '/cached' ? Promise.resolve({ cached: true }) : next(request),
        );
      },
    });

    const slow = itd.request({ method: 'GET', path: '/slow' });
    await vi.waitFor(() => expect(mock.callCount).toBe(1));

    await expect(itd.request({ method: 'GET', path: '/cached' })).resolves.toEqual({
      cached: true,
    });
    expect(mock.callCount).toBe(1);

    releaseSlow();
    await expect(slow).resolves.toEqual({ slow: true });
  });

  it('backoff освобождает слот, а retry заново входит в очередь', async () => {
    let releaseRetry!: () => void;
    let releaseOther!: () => void;
    const clock = {
      now: () => 0,
      schedule(callback: () => void, delay: number) {
        // timeout выключен, поэтому единственный таймер — ожидание retry.
        expect(delay).toBe(1_000);
        releaseRetry = callback;
        return () => {};
      },
    };
    const order: string[] = [];
    let retryCalls = 0;
    const { itd } = makeClient(
      (request) => {
        const path = new URL(request.url).pathname;
        order.push(path);
        if (path === '/retry') {
          retryCalls += 1;
          return retryCalls === 1 ? json({}, { status: 500 }) : json({ data: { retried: true } });
        }
        return new Promise<Response>((resolve) => {
          releaseOther = () => resolve(json({ data: { other: true } }));
        });
      },
      {
        clock,
        timeout: 0,
        retry: { attempts: 2, baseDelay: 1_000, maxDelay: 1_000, jitter: 0 },
        rateLimit: { concurrency: 1 },
      },
    );

    const retried = itd.request({ method: 'GET', path: '/retry' });
    await vi.waitFor(() => expect(releaseRetry).toBeTypeOf('function'));

    // Первый запрос ждёт backoff уже вне queue, поэтому второй использует свободный slot.
    const other = itd.request({ method: 'GET', path: '/other' });
    await vi.waitFor(() => expect(releaseOther).toBeTypeOf('function'));
    expect(order).toEqual(['/retry', '/other']);

    // Retry проснулся, но обязан снова встать в занятую очередь, а не вызвать fetch напрямую.
    releaseRetry();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(order).toEqual(['/retry', '/other']);

    releaseOther();
    await expect(other).resolves.toEqual({ other: true });
    await expect(retried).resolves.toEqual({ retried: true });
    expect(order).toEqual(['/retry', '/other', '/retry']);
  });

  it('после ожидания очереди подставляет самый свежий токен', async () => {
    let releaseFirst!: () => void;
    const { itd, mock } = makeClient(
      (_request, index) =>
        index === 0
          ? new Promise<Response>((resolve) => {
              releaseFirst = () => resolve(json({ data: { first: true } }));
            })
          : json({ data: { second: true } }),
      {
        auth: 'old-token',
        rateLimit: { concurrency: 1 },
        timeout: 0,
      },
    );

    const first = itd.request({ method: 'GET', path: '/first' });
    await vi.waitFor(() => expect(mock.callCount).toBe(1));

    const second = itd.request({ method: 'GET', path: '/second' });
    // Второй запрос уже подготовил auth state, но ждёт занятый транспортный slot.
    await Promise.resolve();
    await itd.setSession({ accessToken: 'fresh-token' });

    releaseFirst();
    await expect(first).resolves.toEqual({ first: true });
    await expect(second).resolves.toEqual({ second: true });

    expect(mock.calls[0]?.headers.get('authorization')).toBe('Bearer old-token');
    expect(mock.calls[1]?.headers.get('authorization')).toBe('Bearer fresh-token');
  });
});

describe('заголовки запросов', () => {
  it('шлёт User-Agent по умолчанию', async () => {
    const { itd, mock } = makeClient([json({ data: {} })]);

    await itd.users.me();

    expect(mock.calls[0]?.headers.get('user-agent')).toMatch(/itd-api\//);
    expect(mock.calls[0]?.headers.get('x-requested-with')).toBe('XMLHttpRequest');
  });

  it('userAgent: false убирает заголовок', async () => {
    const { itd, mock } = makeClient([json({ data: {} })], { userAgent: false });

    await itd.users.me();

    expect(mock.calls[0]?.headers.get('user-agent')).toBeNull();
  });

  it('заголовки из настроек важнее умолчаний', async () => {
    const { itd, mock } = makeClient([json({ data: {} })], {
      headers: { 'User-Agent': 'my-bot/1.0' },
      userAgent: 'default-ua',
    });

    await itd.users.me();

    expect(mock.calls[0]?.headers.get('user-agent')).toBe('my-bot/1.0');
  });
});

describe('общее поведение клиента', () => {
  it('request даёт прямой доступ к API', async () => {
    const { itd } = makeClient([json({ data: { anything: true } })]);

    expect(await itd.request({ method: 'GET', path: '/api/anything', raw: true })).toEqual({
      data: { anything: true },
    });
  });

  it('пробрасывает типизированные ошибки', async () => {
    const { itd } = makeClient([json({ code: 'ENTITY_NOT_FOUND' }, { status: 404 })]);

    await expect(itd.posts.get('нет-такого')).rejects.toThrow(ItdNotFoundError);
  });

  it('createClient равнозначен конструктору', () => {
    const itd = createClient({ baseUrl: 'https://itd.test', auth: 't' });

    expect(itd).toBeInstanceOf(ItdClient);
    expect(itd.baseUrl).toBe('https://itd.test');
  });

  it('пробрасывает отмену в перебор страниц', async () => {
    const controller = new AbortController();
    const { itd, mock } = makeClient(() => {
      controller.abort();
      return feedPage(['1'], '2');
    });

    const collecting = itd.posts.iterate({}, { signal: controller.signal }).collect();

    await expect(collecting).rejects.toThrow(ItdAbortError);
    expect(mock.callCount).toBe(1);
  });

  it('читает сведения об ограничении частоты из ошибки', async () => {
    const { itd } = makeClient([
      json(
        { error: 'Too Many Requests' },
        {
          status: 429,
          headers: { 'x-ratelimit-limit': '5', 'x-ratelimit-remaining': '0' },
        },
      ),
    ]);

    const error = await itd.posts.list().catch((e: unknown) => e);

    expect(error).toMatchObject({ status: 429, rateLimit: 5, rateLimitRemaining: 0 });
  });

  it('тормозит бакет, не дожидаясь отказа сервера', async () => {
    const starts: number[] = [];
    const begin = Date.now();

    // Первый ответ сообщает, что лимит исчерпан, — бакет обязан притормозить ровно на то
    // время, за которое сервер вернёт одну единицу квоты: 60000 / limit.
    const { itd } = makeClient(
      () => {
        starts.push(Date.now() - begin);
        return json(
          { data: { posts: [], pagination: { hasMore: false } } },
          { headers: { 'x-ratelimit-limit': '600', 'x-ratelimit-remaining': '0' } },
        );
      },
      { rateLimit: { concurrency: 1 } },
    );

    await itd.posts.list();
    await itd.posts.list();

    expect(starts).toHaveLength(2);
    expect(starts[1] ?? 0).toBeGreaterThanOrEqual(100);
  });

  it('исчерпание одного бакета не задерживает другой', async () => {
    const starts: string[] = [];

    const { itd } = makeClient(
      (request) => {
        starts.push(request.url);
        return request.url.includes('/api/posts?') || request.url.endsWith('/api/posts')
          ? json(
              { data: { posts: [], pagination: { hasMore: false } } },
              // Лимит 6 даёт паузу в десять секунд: если бы она была общей, второй
              // запрос не успел бы уйти за отведённое тесту время.
              { headers: { 'x-ratelimit-limit': '6', 'x-ratelimit-remaining': '0' } },
            )
          : json({ data: { version: '1.0.0' } });
      },
      { rateLimit: { concurrency: 1 } },
    );

    await itd.posts.list();
    await itd.platform.version();

    expect(starts).toHaveLength(2);
  });

  it('показывает остаток по каждому счётчику отдельно', async () => {
    const { itd } = makeClient(
      (request) =>
        request.url.includes('/api/platform/version')
          ? json(
              { data: { version: '1.0.0' } },
              { headers: { 'x-ratelimit-limit': '150', 'x-ratelimit-remaining': '149' } },
            )
          : json(
              { data: { posts: [], pagination: { hasMore: false } } },
              { headers: { 'x-ratelimit-limit': '90', 'x-ratelimit-remaining': '87' } },
            ),
      { rateLimit: { concurrency: 1 } },
    );

    expect(itd.rateLimitState()).toEqual([]);

    await itd.posts.list();
    await itd.platform.version();

    expect(itd.rateLimitState()).toEqual([
      expect.objectContaining({ bucket: 'feed', limit: 90, remaining: 87 }),
      expect.objectContaining({ bucket: 'default', limit: 150, remaining: 149 }),
    ]);
  });

  it('close сохраняет остаток квоты, dispose очищает', async () => {
    const { itd } = makeClient(
      () =>
        json(
          { data: { posts: [], pagination: { hasMore: false } } },
          { headers: { 'x-ratelimit-limit': '90', 'x-ratelimit-remaining': '87' } },
        ),
      { rateLimit: { concurrency: 1 } },
    );

    await itd.posts.list();

    // Серверный счётчик от закрытия клиента не сбрасывается: продолжив работу, клиент
    // не должен считать бакет нетронутым.
    await itd.close();
    expect(itd.rateLimitState()).toEqual([
      expect.objectContaining({ bucket: 'feed', limit: 90, remaining: 87 }),
    ]);
    await itd.posts.list();

    await itd.dispose();
    expect(itd.rateLimitState()).toEqual([]);
  });

  it('rateLimitBucket уводит низкоуровневый запрос из умолчания', async () => {
    const { itd } = makeClient(() => json({ data: { ok: true } }), {
      rateLimit: { concurrency: 1 },
    });

    await itd.request({ method: 'GET', path: '/api/whatever' });
    await itd.request({ method: 'POST', path: '/api/posts', rateLimitBucket: 'posts.create' });

    expect(itd.rateLimitState().map((state) => state.bucket)).toEqual(['default', 'posts.create']);
  });

  it('close не сбрасывает паузу исчерпанного бакета', async () => {
    const starts: number[] = [];
    const begin = Date.now();

    const { itd } = makeClient(
      () => {
        starts.push(Date.now() - begin);
        return json(
          { data: { posts: [], pagination: { hasMore: false } } },
          { headers: { 'x-ratelimit-limit': '120', 'x-ratelimit-remaining': '0' } },
        );
      },
      { rateLimit: { concurrency: 1 } },
    );

    await itd.posts.list();

    // Лимит 120 даёт паузу в полсекунды. Закрытие клиента серверный счётчик
    // не восстанавливает, поэтому следующий запрос обязан её досидеть.
    await itd.close();
    await itd.posts.list();

    expect(starts).toHaveLength(2);
    expect(starts[1] ?? 0).toBeGreaterThanOrEqual(500);
  });

  it('rateLimitBucket с опечаткой отвергается до отправки', async () => {
    const { itd, mock } = makeClient(() => json({ data: { ok: true } }), {
      rateLimit: { concurrency: 1 },
    });

    await expect(
      itd.request({ method: 'POST', path: '/api/posts', rateLimitBucket: 'posts.craete' }),
    ).rejects.toThrow(ItdConfigError);
    expect(mock.callCount).toBe(0);
  });

  it('rateLimitBucket проверяется и при выключенной очереди', async () => {
    // makeClient по умолчанию идёт с rateLimit: false. Бакет там ни на что не влияет,
    // но опечатка остаётся опечаткой и не должна зависеть от режима.
    const { itd, mock } = makeClient(() => json({ data: { ok: true } }));

    await expect(
      itd.request({ method: 'GET', path: '/api/whatever', rateLimitBucket: 'feeed' }),
    ).rejects.toThrow(ItdConfigError);
    expect(mock.callCount).toBe(0);
  });

  it('своё правило выбора бакета снимает проверку rateLimitBucket', async () => {
    const { itd } = makeClient(() => json({ data: { ok: true } }), {
      rateLimit: { concurrency: 1, bucket: () => undefined },
    });

    await itd.request({ method: 'GET', path: '/api/whatever', rateLimitBucket: 'proxy' });

    expect(itd.rateLimitState().map((state) => state.bucket)).toEqual(['proxy']);
  });

  it('не тормозит, пока лимит не исчерпан', async () => {
    const { itd, mock } = makeClient(
      () =>
        json(
          { data: { posts: [], pagination: { hasMore: false } } },
          { headers: { 'x-ratelimit-limit': '5', 'x-ratelimit-remaining': '3' } },
        ),
      { rateLimit: { concurrency: 1, retryDelays: [5000] } },
    );

    await itd.posts.list();
    await itd.posts.list();

    expect(mock.callCount).toBe(2);
  });

  it('при 429 идёт по лестнице пауз, а не по экспоненте', async () => {
    const delays: number[] = [];
    let calls = 0;

    const { itd } = makeClient(
      () => {
        calls += 1;
        // Отдаём 429 первые три раза, затем нормальный ответ.
        return calls <= 3
          ? json({ error: 'Too Many Requests' }, { status: 429 })
          : json({ data: { posts: [], pagination: { hasMore: false } } });
      },
      {
        rateLimit: { concurrency: 1, retryDelays: [10, 20, 40] },
        hooks: {
          onRetry: (context) => {
            delays.push(context.delay);
          },
        },
      },
    );

    await itd.posts.list();

    expect(delays).toEqual([10, 20, 40]);
  });

  it('когда лестница закончилась, отдаёт 429 вызывающему коду', async () => {
    const { itd, mock } = makeClient(() => json({ error: 'Too Many Requests' }, { status: 429 }), {
      rateLimit: { concurrency: 1, retryDelays: [10, 20] },
    });

    await expect(itd.posts.list()).rejects.toMatchObject({ status: 429 });
    // Первая попытка плюс две по лестнице.
    expect(mock.callCount).toBe(3);
  });

  it('лестница 429 не зависит от retry.attempts', async () => {
    let calls = 0;

    const { itd } = makeClient(
      () => {
        calls += 1;
        return calls <= 3
          ? json({ error: 'Too Many Requests' }, { status: 429 })
          : json({ data: { posts: [], pagination: { hasMore: false } } });
      },
      {
        // Одна попытка для сетевых ошибок — но лимит частоты живёт по своим правилам.
        retry: { attempts: 1 },
        rateLimit: { concurrency: 1, retryDelays: [10, 20, 40] },
      },
    );

    await itd.posts.list();

    expect(calls).toBe(4);
  });

  it('повторяет запрос при 500 и отдаёт результат', async () => {
    let calls = 0;
    const { itd } = makeClient(
      () => {
        calls += 1;
        return calls === 1 ? json({}, { status: 500 }) : feedPage(['1'], null);
      },
      { retry: { attempts: 2, baseDelay: 0 } },
    );

    expect((await itd.posts.list()).items).toHaveLength(1);
    expect(calls).toBe(2);
  });

  it('на новой retry-попытке заново читает обновлённый токен', async () => {
    let client: ItdClient | undefined;
    const built = makeClient(
      (request, index) =>
        index === 0
          ? json({}, { status: 500 })
          : request.headers.get('authorization') === 'Bearer fresh-token'
            ? feedPage(['1'], null)
            : json({}, { status: 401 }),
      {
        auth: 'old-token',
        retry: { attempts: 2, baseDelay: 0, jitter: 0 },
        hooks: {
          onRetry: () => client?.setSession({ accessToken: 'fresh-token' }),
        },
      },
    );
    client = built.itd;

    await expect(client.posts.list()).resolves.toMatchObject({ items: [{ id: '1' }] });
    expect(built.mock.calls[0]?.headers.get('authorization')).toBe('Bearer old-token');
    expect(built.mock.calls[1]?.headers.get('authorization')).toBe('Bearer fresh-token');
  });

  it('retry у запроса переопределяет глобальную настройку', async () => {
    let calls = 0;
    const { itd } = makeClient(
      () => {
        calls += 1;
        return json({}, { status: 500 });
      },
      { retry: { attempts: 5, baseDelay: 0 } },
    );

    // Глобально до 5 попыток, но у конкретного запроса повторы выключены.
    await expect(itd.posts.list({}, { retry: false })).rejects.toMatchObject({ status: 500 });
    expect(calls).toBe(1);
  });
});

describe('ленивые ресурсы', () => {
  const RESOURCE_NAMES = [
    'auth',
    'users',
    'posts',
    'comments',
    'files',
    'notifications',
    'hashtags',
    'search',
    'reports',
    'verification',
    'subscription',
    'platform',
    'telemetry',
  ] as const;

  it('конструктор не создаёт ни одного ресурса', () => {
    const { itd } = makeClient([]);

    // Геттеры живут на прототипе: собственных свойств с такими именами быть не должно,
    // иначе ресурс был бы создан заранее.
    const own = new Set(Object.getOwnPropertyNames(itd));
    expect(RESOURCE_NAMES.filter((name) => own.has(name))).toEqual([]);
  });

  it('отдаёт каждый ресурс и создаёт его один раз', () => {
    const { itd } = makeClient([]);

    for (const name of RESOURCE_NAMES) {
      const resource = itd[name];
      expect(resource).toBeTypeOf('object');
      expect(itd[name]).toBe(resource);
    }
  });

  it('notifications владеет одним стабильным events-channel', () => {
    const { itd } = makeClient([]);

    expect(itd.notifications.events).toBe(itd.notifications.events);
  });

  it('читается через Reflect.get — так его берёт @itd-api/hydrate', () => {
    const { itd } = makeClient([]);

    expect(Reflect.get(itd, 'posts', itd)).toBe(itd.posts);
  });

  it('замыкание загрузки видит ленивый files', async () => {
    const { itd, mock } = makeClient((request) =>
      request.url.includes('/files/upload')
        ? json({ id: 'banner-1', url: 'https://cdn/banner.webp' })
        : json({ id: 'u1' }),
    );

    // users поднят раньше files: замыкание обращается к геттеру в момент вызова,
    // а не к значению, снятому в конструкторе.
    const users = itd.users;
    await users.setBanner(new Blob(['image'], { type: 'image/webp' }), {
      filename: 'banner.webp',
    });

    expect(new URL(mock.calls[0]?.url ?? '').pathname).toBe('/api/files/upload');
  });

  it('close() не поднимает телеметрию', async () => {
    const close = vi.spyOn(TelemetryResource.prototype, 'close');
    const { itd } = makeClient([]);

    await itd.close();
    expect(close).not.toHaveBeenCalled();

    // А если к накопителю обращались — закрыть его обязаны.
    void itd.telemetry;
    await itd.close();
    expect(close).toHaveBeenCalledOnce();

    close.mockRestore();
  });
});

describe('жизненный цикл', () => {
  it('проверяет полную конфигурацию events при создании клиента', () => {
    expect(() => new ItdClient({ events: { notifications: { concurrency: 0 } } })).toThrow(
      ItdConfigError,
    );
  });

  it('close() остаётся временной остановкой и не запрещает дальнейшую работу', async () => {
    const { itd } = makeClient([json({ data: { id: '1' } })], {
      events: { notifications: { syncCount: false } },
    });

    await itd.close();
    itd.use({ name: 'after-close', install() {} });
    const stream = itd.notifications.events;

    await expect(itd.posts.get('1')).resolves.toMatchObject({ id: '1' });
    expect(stream.status).toBe('disconnected');

    await itd.dispose();
  });

  it('dispose() сразу переводит клиент и ранее полученные фасады в терминальное состояние', async () => {
    const { itd, mock } = makeClient([], {
      events: { notifications: { syncCount: false } },
    });
    const posts = itd.posts;
    const stream = itd.notifications.events;

    const disposing = itd.dispose();

    expect(() => itd.use({ name: 'late', install() {} })).toThrow(ItdStateError);
    expect(() => itd.on('tokens', () => {})).toThrow(ItdStateError);
    expect(() => itd.defineService({ name: 'late', baseUrl: 'https://late.itd.test' })).toThrow(
      ItdStateError,
    );
    await expect(posts.get('1')).rejects.toBeInstanceOf(ItdStateError);
    await expect(stream.connect()).rejects.toBeInstanceOf(ItdStateError);
    await expect(itd.setSession({ accessToken: 'late' })).rejects.toBeInstanceOf(ItdStateError);

    await disposing;
    await expect(itd.dispose()).resolves.toBeUndefined();
    expect(mock.callCount).toBe(0);
  });

  it('сохраняет события при смене sid и завершает при смене sub', async () => {
    const transport = new TestStreamTransport();
    const { itd } = makeClient([], {
      auth: makeJwt({ sub: 'user-a', sid: 'session-a' }),
      events: { notifications: { transport, syncCount: false } },
    });
    const stream = itd.notifications.events;
    const disconnect = vi.spyOn(stream, 'disconnect');
    await stream.connect();

    await itd.setSession({
      accessToken: makeJwt({ sub: 'user-a', sid: 'session-b' }),
    });
    expect(disconnect).not.toHaveBeenCalled();

    await itd.setSession({
      accessToken: makeJwt({ sub: 'user-b', sid: 'session-c' }),
    });
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it('завершает события при смене sub во внешнем источнике токена', async () => {
    let token = makeJwt({ sub: 'user-a', sid: 'session-a' });
    const transport = new TestStreamTransport();
    const { itd } = makeClient(
      [json({ id: '1', content: 'первый' }), json({ id: '2', content: 'второй' })],
      {
        auth: { getToken: () => token },
        events: { notifications: { transport, syncCount: false } },
      },
    );
    const stream = itd.notifications.events;
    const disconnect = vi.spyOn(stream, 'disconnect');
    await stream.connect();

    await itd.posts.get('1');
    expect(disconnect).not.toHaveBeenCalled();

    token = makeJwt({ sub: 'user-b', sid: 'session-b' });
    await itd.posts.get('2');

    expect(disconnect).toHaveBeenCalledOnce();
  });

  it('close() закрывает порождённые потоки и снимает паузу очереди', async () => {
    const { itd } = makeClient([], { rateLimit: { concurrency: 1, retryDelays: [1000] } });

    const stream = itd.notifications.events;
    expect(stream.status).toBe('disconnected');

    // Ставим очередь на длинную паузу — close() обязан её снять, иначе таймер удержит loop.
    itd.request({ method: 'GET', path: '/api/posts' }).catch(() => {});

    await itd.close();

    // Повторный close() безвреден.
    await itd.close();
  });

  it('ручной disconnect убирает активный канал из close()', async () => {
    const transport = new TestStreamTransport();
    const { itd } = makeClient([], {
      events: { notifications: { transport, syncCount: false } },
    });
    const stream = itd.notifications.events;
    const disconnect = vi.spyOn(stream, 'disconnect');

    await stream.connect();
    stream.disconnect();
    await itd.close();

    expect(disconnect).toHaveBeenCalledOnce();
  });

  it('await using закрывает потоки на выходе из блока', async () => {
    const transport = new TestStreamTransport();
    const { itd } = makeClient([json({ data: { id: '1' } })], {
      events: { notifications: { transport, syncCount: false } },
    });
    const stream = itd.notifications.events;
    const disconnect = vi.spyOn(stream, 'disconnect');
    await stream.connect();

    {
      await using guard = itd;
      expect(guard).toBe(itd);
      await itd.users.me();
    }

    expect(disconnect).toHaveBeenCalled();
  });

  it('dispose() отменяет начатый запрос и отклоняет ожидающие в очереди', async () => {
    const mock = createHangingFetch();
    const itd = new ItdClient({
      baseUrl: 'https://itd.test',
      fetch: mock.fetch,
      auth: 'test-token',
      retry: false,
      rateLimit: { concurrency: 1 },
      mode: 'server',
    });

    const active = itd.posts.get('1').catch((error: unknown) => error);
    const waiting = itd.posts.get('2').catch((error: unknown) => error);
    await vi.waitFor(() => expect(mock.callCount).toBe(1));

    await itd.dispose();

    const cancelled = (await active) as ItdAbortError;
    expect(cancelled).toBeInstanceOf(ItdAbortError);
    // Причина отмены доходит до вызывающего кода.
    expect((cancelled.cause as Error).message).toMatch(/dispose\(\)/);
    expect(await waiting).toBeInstanceOf(ItdAbortError);
    // Ожидавший очереди запрос до сети так и не дошёл.
    expect(mock.callCount).toBe(1);
  });

  it('close() отменяет начальную синхронизацию счётчика уведомлений', async () => {
    const mock = createHangingFetch();
    const transport = new TestStreamTransport();
    const itd = new ItdClient({
      baseUrl: 'https://itd.test',
      fetch: mock.fetch,
      auth: 'test-token',
      retry: false,
      rateLimit: false,
      mode: 'server',
      events: { notifications: { transport } },
    });
    const connecting = itd.notifications.events.connect();
    await vi.waitFor(() => expect(mock.callCount).toBe(1));
    const signal = mock.calls[0]?.signal;

    await itd.close();
    await connecting;

    expect(signal?.aborted).toBe(true);
  });

  it('close() ограничивает освобождение ресурсов транспорта общим shutdownTimeout', async () => {
    let releaseTransportCleanup: (() => void) | undefined;
    const transport: EventTransport = {
      name: 'slow-cleanup',
      connect: (context) => {
        context.onOpen();
        return new Promise<void>((resolve) => {
          context.signal.addEventListener(
            'abort',
            () => {
              releaseTransportCleanup = resolve;
            },
            { once: true },
          );
        });
      },
    };
    const { itd } = makeClient([], {
      shutdownTimeout: 20,
      events: { notifications: { transport, syncCount: false } },
    });
    const stream = itd.notifications.events;

    await stream.connect();
    stream.disconnect();
    const error = await itd.close().catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ItdStateError);
    expect((error as Error).message).toMatch(
      /ресурсы \(notifications:slow-cleanup\) не завершились за 20 мс/,
    );

    releaseTransportCleanup?.();
    await stream.drain();
  });

  it('dispose() не ждёт зависший обработчик потока дольше срока и называет поток', async () => {
    const transport = new TestStreamTransport();
    const { itd } = makeClient([], {
      shutdownTimeout: 20,
      events: { notifications: { transport, syncCount: false } },
    });
    const stream = itd.notifications.events;
    stream.onUpdate(() => new Promise<never>(() => {}));

    await stream.connect();
    transport.emit({ name: 'notification', data: { payload: { id: 'n1', type: 'like' } } });

    const error = (await itd.dispose().catch((cause: unknown) => cause)) as AggregateError;
    const [stuck] = error.errors as Error[];

    expect(stuck).toBeInstanceOf(ItdStateError);
    expect(stuck?.message).toMatch(/ресурсы \(notifications:test\) не завершились за 20 мс/);
  });

  it('dispose() не ждёт зависшую операцию плагина дольше срока и называет плагин', async () => {
    const { itd } = makeClient([], { shutdownTimeout: 20 });
    let entered = false;
    itd.use({
      name: 'stuck',
      install({ operations }) {
        operations.use(() => {
          entered = true;
          return new Promise<never>(() => {});
        });
      },
    });

    void itd.posts.get('1').catch(() => {});
    await vi.waitFor(() => expect(entered).toBe(true));

    const error = (await itd.dispose().catch((cause: unknown) => cause)) as AggregateError;
    const [plugins] = error.errors as AggregateError[];
    const [stuck] = (plugins?.errors ?? []) as Error[];

    expect(stuck).toBeInstanceOf(ItdStateError);
    expect(stuck?.message).toMatch(/плагин «stuck» не завершил операции за 20 мс/);
  });

  it('поток, исчерпавший попытки, покидает клиент и возвращается по connect()', async () => {
    const transport = new TestStreamTransport();
    const { itd } = makeClient([], {
      events: { notifications: { transport, syncCount: false, maxAttempts: 0 } },
    });
    const stream = itd.notifications.events;
    const disconnect = vi.spyOn(stream, 'disconnect');
    stream.on('error', () => {});

    await stream.connect();
    await new Promise<void>((resolve) => {
      stream.once('giveup', resolve);
      transport.fail(new Error('сервер недоступен'));
    });

    await itd.close();
    expect(disconnect).not.toHaveBeenCalled();

    await stream.connect();
    await itd.close();
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
