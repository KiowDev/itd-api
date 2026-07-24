import { describe, expect, it, vi } from 'vitest';
import { createClient, ItdClient } from '../src/client.js';
import { ItdConfigError, ItdNotFoundError } from '../src/core/errors.js';
import type { ItdClientOptions } from '../src/types/options.js';
import { createMockFetch, json, type MockHandler, noContent } from './helpers/mock-fetch.js';

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

  it('объясняет, что путь работает только в Node', async () => {
    const { itd } = makeClient([]);

    await expect(itd.posts.create((p) => p.content('т').attach('./a.png'))).rejects.toThrow(
      /itd-api\/node/,
    );
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

  it('принимает имя пользователя вместо идентификатора', async () => {
    const { itd, mock } = makeClient([json({ id: 'u1', username: 'durov' })]);

    await itd.users.get('durov');

    expect(mock.calls[0]?.url).toBe('https://itd.test/api/users/durov');
  });

  it('перебирает подписчиков постранично', async () => {
    const page = (users: string[], hasMore: boolean, page: number) =>
      json({
        data: { users: users.map((id) => ({ id })), pagination: { page, total: 3, hasMore } },
      });

    const { itd, mock } = makeClient([page(['1', '2'], true, 1), page(['3'], false, 2)]);

    const all = await itd.users.iterateFollowers('durov').collect();

    expect(all).toHaveLength(3);
    expect(mock.calls[1]?.url).toContain('page=2');
  });

  it('читает признак доступности имени', async () => {
    const { itd } = makeClient([json({ available: true })]);

    expect(await itd.users.checkUsername('новое_имя')).toBe(true);
  });

  it('достаёт список из поля users', async () => {
    const { itd } = makeClient([json({ data: { users: [{ id: 'u1' }, { id: 'u2' }] } })]);

    expect(await itd.users.search('привет')).toHaveLength(2);
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
  it('сохраняет токен после входа', async () => {
    const { itd, mock } = makeClient([json({ accessToken: 'signed-in' }), json({ id: 'u1' })], {
      auth: undefined,
    });

    const result = await itd.auth.signIn({ email: 'a@b.c', password: 'p', turnstileToken: 'cap' });

    expect(result).toEqual({ status: 'authenticated', accessToken: 'signed-in' });
    await itd.users.me();
    expect(mock.calls[1]?.headers.get('authorization')).toBe('Bearer signed-in');
  });

  it('сообщает о требовании кода подтверждения', async () => {
    const { itd } = makeClient([json({ flowToken: 'flow-1' })], { auth: undefined });

    expect(await itd.auth.signIn({ email: 'a@b.c', password: 'p', turnstileToken: 'cap' })).toEqual(
      {
        status: 'otp_required',
        flowToken: 'flow-1',
      },
    );
  });

  it('проходит полный вход с кодом', async () => {
    const { itd, mock } = makeClient(
      [json({ flowToken: 'flow-1' }), json({ accessToken: 'verified' })],
      { auth: undefined },
    );

    const token = await itd.auth.signInWithOtp({
      email: 'a@b.c',
      password: 'p',
      turnstileToken: 'cap',
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

  it('строит адрес внешнего входа', () => {
    const { itd } = makeClient([]);

    expect(itd.auth.oauthUrl('yandex')).toBe('https://itd.test/api/v1/auth/login/yandex');
  });

  it('сообщает о получении токена', async () => {
    const { itd } = makeClient([json({ accessToken: 'новый' })], { auth: undefined });
    const onTokens = vi.fn();
    itd.on('tokens', onTokens);

    await itd.auth.signIn({ email: 'a@b.c', password: 'p', turnstileToken: 'cap' });

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
      turnstileToken: 'cap',
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
   * Запросы авторизации идут мимо очереди намеренно.
   *
   * Продление токена запускается изнутри запроса, который уже занял место в очереди
   * и ждёт его результата. Если поставить продление в ту же очередь, оба будут ждать
   * друг друга: при `concurrency: 1` намертво с первого же 401, при умолчании — как
   * только столько запросов разом получат 401, сколько мест в очереди.
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

  it('продление не встаёт в очередь за собственным запросом', async () => {
    const { itd, refreshes } = makeExpiring({ concurrency: 1 });

    await expect(itd.users.me()).resolves.toEqual({ ok: true });
    expect(refreshes()).toBe(1);
  });

  it('очередь не блокируется, когда все места заняты запросами с 401', async () => {
    // Запросов ровно столько же, сколько мест: каждый держит место и ждёт продления.
    const { itd, refreshes } = makeExpiring({ concurrency: 3 });

    const all = await Promise.all(Array.from({ length: 3 }, () => itd.users.me()));

    expect(all).toHaveLength(3);
    expect(refreshes()).toBe(1);
  });

  it('отложенный вход не блокирует очередь', async () => {
    const { itd, mock } = makeClient(
      (request) =>
        request.url.endsWith('/sign-in')
          ? json({ accessToken: 'at' })
          : json({ data: { ok: true } }),
      {
        auth: { email: 'a@b.c', password: 'p', turnstileToken: 'cap' },
        rateLimit: { concurrency: 1 },
      },
    );

    await expect(itd.users.me()).resolves.toEqual({ ok: true });
    expect(mock.calls[0]?.url).toContain('/sign-in');
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

    const collected = await itd.posts.iterate({ signal: controller.signal }).collect();

    expect(mock.callCount).toBe(1);
    expect(collected).toEqual([]);
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

  it('тормозит очередь, не дожидаясь отказа сервера', async () => {
    const starts: number[] = [];
    const begin = Date.now();

    // Первый ответ сообщает, что лимит исчерпан, — очередь обязана притормозить.
    const { itd } = makeClient(
      () => {
        starts.push(Date.now() - begin);
        return json(
          { data: { posts: [], pagination: { hasMore: false } } },
          { headers: { 'x-ratelimit-limit': '5', 'x-ratelimit-remaining': '0' } },
        );
      },
      { rateLimit: { concurrency: 1, retryDelays: [300] } },
    );

    await itd.posts.list();
    await itd.posts.list();

    expect(starts).toHaveLength(2);
    expect(starts[1] ?? 0).toBeGreaterThanOrEqual(250);
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
    await expect(itd.posts.list({ retry: false })).rejects.toMatchObject({ status: 500 });
    expect(calls).toBe(1);
  });
});

describe('жизненный цикл', () => {
  it('close() закрывает порождённые потоки и снимает паузу очереди', async () => {
    const { itd } = makeClient([], { rateLimit: { concurrency: 1, retryDelays: [1000] } });

    const stream = itd.realtime();
    expect(stream.status).toBe('disconnected');

    // Ставим очередь на длинную паузу — close() обязан её снять, иначе таймер удержит loop.
    itd.request({ method: 'GET', path: '/api/posts' }).catch(() => {});

    await itd.close();

    // Повторный close() безвреден.
    await itd.close();
  });

  it('ручной disconnect убирает поток из close()', async () => {
    const { itd } = makeClient([]);
    const stream = itd.realtime();
    const disconnect = vi.spyOn(stream, 'disconnect');

    stream.disconnect();
    await itd.close();

    expect(disconnect).toHaveBeenCalledOnce();
  });

  it('await using закрывает потоки на выходе из блока', async () => {
    const { itd } = makeClient([json({ data: { id: '1' } })]);
    const stream = itd.realtime();
    const disconnect = vi.spyOn(stream, 'disconnect');

    {
      await using guard = itd;
      expect(guard).toBe(itd);
      await itd.users.me();
    }

    expect(disconnect).toHaveBeenCalled();
  });
});
