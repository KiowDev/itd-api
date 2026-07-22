import { ItdClient } from 'itd-api';
import { describe, expect, it } from 'vitest';
import {
  beecrypt,
  CryptError,
  crypt,
  encodeBeeCrypt,
  encodeInvisible,
  invisible,
  secretOf,
  stripInvisible,
} from '../src/index.js';

/** Перехваченный запрос: нужен и URL, и тело. */
interface Call {
  url: string;
  method: string;
  body: Record<string, unknown>;
}

function makeClient(responses: unknown[]) {
  const calls: Call[] = [];
  let index = 0;

  const fetchMock = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : {},
    });

    const payload = responses[index++] ?? {};
    return new Response(JSON.stringify({ data: payload }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  const itd = new ItdClient({
    baseUrl: 'https://itd.test',
    fetch: fetchMock,
    auth: 'test-token',
    retry: false,
    rateLimit: false,
    mode: 'server',
  });

  return { itd, calls };
}

describe('шифрование запроса', () => {
  it('прячет текст поста', async () => {
    const { itd, calls } = makeClient([{ id: '1' }]);
    itd.use(crypt());

    await itd.posts.create({ content: 'секрет' }, { encrypt: 'invisible' });

    const sent = String(calls[0]?.body.content);
    expect(stripInvisible(sent)).toBe('');
    expect(invisible.decode(sent)).toBe('секрет');
  });

  it('оставляет обложку видимой', async () => {
    const { itd, calls } = makeClient([{ id: '1' }]);
    itd.use(crypt());

    await itd.posts.create(
      { content: 'секрет' },
      { encrypt: { cipher: 'invisible', cover: 'обычный текст' } },
    );

    const sent = String(calls[0]?.body.content);
    expect(stripInvisible(sent)).toBe('обычный текст');
    expect(invisible.decode(sent)).toBe('секрет');
  });

  it('без encrypt тело не трогает', async () => {
    const { itd, calls } = makeClient([{ id: '1' }]);
    itd.use(crypt());

    await itd.posts.create({ content: 'обычный пост' });

    expect(calls[0]?.body.content).toBe('обычный пост');
  });

  it('работает для комментария, ответа и правки', async () => {
    const { itd, calls } = makeClient([{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }]);
    itd.use(crypt());

    await itd.posts.comment('p1', 'секрет', { encrypt: 'invisible' });
    await itd.comments.reply('c1', 'ответ', { encrypt: 'invisible' });
    await itd.comments.update('c1', 'правка', { encrypt: 'invisible' });

    expect(calls.map((call) => invisible.decode(String(call.body.content)))).toEqual([
      'секрет',
      'ответ',
      'правка',
    ]);
  });

  it('шифрует профиль целиком, а с fields — только выбранное поле', async () => {
    const { itd, calls } = makeClient([{ id: 'u1' }, { id: 'u1' }]);
    itd.use(crypt());

    await itd.users.updateMe({ displayName: 'имя', bio: 'подпись' }, { encrypt: 'invisible' });
    await itd.users.updateMe(
      { displayName: 'имя', bio: 'подпись' },
      { encrypt: { cipher: 'invisible', fields: ['bio'], cover: 'видимая подпись' } },
    );

    expect(invisible.decode(String(calls[0]?.body.displayName))).toBe('имя');
    expect(invisible.decode(String(calls[0]?.body.bio))).toBe('подпись');

    expect(calls[1]?.body.displayName).toBe('имя');
    expect(stripInvisible(String(calls[1]?.body.bio))).toBe('видимая подпись');
  });

  it('отказывается шифровать там, где текста нет', async () => {
    const { itd } = makeClient([{}]);
    itd.use(crypt());

    await expect(itd.posts.like('p1', { encrypt: 'invisible' })).rejects.toThrow(CryptError);
  });

  it('сообщает о неизвестном шифре и о чужом поле', async () => {
    const { itd } = makeClient([{}, {}]);
    itd.use(crypt());

    await expect(itd.posts.create({ content: 'x' }, { encrypt: 'coffee' })).rejects.toThrow(
      /не подключён/,
    );
    await expect(
      itd.posts.create({ content: 'x' }, { encrypt: { fields: ['bio'] } }),
    ).rejects.toThrow(/не принимает поля bio/);
  });

  it('не даёт одной обложкой затереть и имя, и подпись', async () => {
    const { itd } = makeClient([{}]);
    itd.use(crypt());

    await expect(
      itd.users.updateMe(
        { displayName: 'имя', bio: 'подпись' },
        { encrypt: { cover: 'одна на двоих' } },
      ),
    ).rejects.toThrow(/Выберите одно через fields/);
  });
});

describe('разметка при шифровании', () => {
  const spans = [{ type: 'bold' as const, offset: 0, length: 6 }];

  it('spans по обложке уходят как есть', async () => {
    const { itd, calls } = makeClient([{ id: '1' }]);
    itd.use(crypt());

    await itd.posts.create(
      { content: 'секрет', spans },
      { encrypt: { cipher: 'invisible', cover: 'жирное слово' } },
    );

    expect(calls[0]?.body.spans).toEqual(spans);
    expect(stripInvisible(String(calls[0]?.body.content))).toBe('жирное слово');
  });

  it('без обложки разметку крепить не к чему', async () => {
    const { itd } = makeClient([{}]);
    itd.use(crypt());

    await expect(
      itd.posts.create({ content: 'секрет', spans }, { encrypt: 'invisible' }),
    ).rejects.toThrow(/обложка не задана/);
  });

  it('шифр без обложки разметку не переживёт', async () => {
    const { itd } = makeClient([{}]);
    itd.use(crypt());

    await expect(
      itd.posts.create({ content: 'секрет', spans }, { encrypt: 'beecrypt' }),
    ).rejects.toThrow(/не оставляет видимого текста/);
  });

  it('ловит spans, посчитанные по секрету вместо обложки', async () => {
    const { itd } = makeClient([{}]);
    itd.use(crypt());

    await expect(
      itd.posts.create(
        { content: 'жирное слово', spans },
        { encrypt: { cipher: 'invisible', cover: 'ок' } },
      ),
    ).rejects.toThrow(/не укладывается в обложку/);
  });

  it('без spans обложка ничем не ограничена', async () => {
    const { itd, calls } = makeClient([{ id: '1' }]);
    itd.use(crypt());

    await itd.posts.create({ content: 'секрет' }, { encrypt: { cover: 'ок' } });

    expect(stripInvisible(String(calls[0]?.body.content))).toBe('ок');
  });
});

describe('расшифровка ответа', () => {
  const hidden = (visible: string, secret: string) => visible + encodeInvisible(secret);

  it('находит сообщение в посте, не трогая content', async () => {
    const content = hidden('обычный текст', 'секрет');
    const { itd } = makeClient([{ id: '1', content }]);
    itd.use(crypt());

    const post = await itd.posts.get('1');

    expect(post.content).toBe(content);
    expect(post.secret).toEqual({ cipher: 'invisible', field: 'content', text: 'секрет' });
    expect(secretOf(post)?.text).toBe('секрет');
  });

  it('обходит ленту вглубь: репост, комментарии, автора', async () => {
    const { itd } = makeClient([
      {
        posts: [
          {
            id: '1',
            content: hidden('репост', 'снаружи'),
            author: { id: 'u1', displayName: hidden('Имя', 'автор') },
            originalPost: { id: '0', content: hidden('исходный', 'внутри') },
            comments: [{ id: 'c1', content: hidden('коммент', 'в комменте') }],
          },
        ],
        pagination: { hasMore: false, nextCursor: null },
      },
    ]);
    itd.use(crypt());

    const page = await itd.posts.list();
    const post = page.items[0];

    expect(post?.secret?.text).toBe('снаружи');
    expect(post?.originalPost?.secret?.text).toBe('внутри');
    expect(post?.comments?.[0]?.secret?.text).toBe('в комменте');
    expect(post?.author.secret).toEqual({
      cipher: 'invisible',
      field: 'displayName',
      text: 'автор',
    });
  });

  it('собирает несколько находок профиля', async () => {
    const { itd } = makeClient([
      { id: 'u1', displayName: hidden('Имя', 'первое'), bio: hidden('о себе', 'второе') },
    ]);
    itd.use(crypt());

    const profile = await itd.users.get('u1');

    expect(profile.secrets?.map((secret) => secret.text)).toEqual(['второе', 'первое']);
    expect(profile.secret?.field).toBe('bio');
  });

  it('обычный ответ не помечает', async () => {
    const { itd } = makeClient([{ id: '1', content: 'обычный пост' }]);
    itd.use(crypt());

    const post = await itd.posts.get('1');

    expect(post.secret).toBeUndefined();
    expect(post.secrets).toBeUndefined();
  });

  it('decrypt: false отключает обход — глобально и у одного вызова', async () => {
    const content = hidden('обычный текст', 'секрет');

    const off = makeClient([{ id: '1', content }]);
    off.itd.use(crypt({ decrypt: false }));
    expect((await off.itd.posts.get('1')).secret).toBeUndefined();

    const once = makeClient([{ id: '1', content }]);
    once.itd.use(crypt());
    expect((await once.itd.posts.get('1', { decrypt: false })).secret).toBeUndefined();
  });

  it('crypt({ decrypt: false }) не мешает включить расшифровку у вызова', async () => {
    const { itd } = makeClient([{ id: '1', content: hidden('текст', 'секрет') }]);
    itd.use(crypt({ decrypt: false }));

    const post = await itd.posts.get('1', { decrypt: true });

    expect(post.secret?.text).toBe('секрет');
  });
});

describe('несколько шифров', () => {
  it('без имени берётся первый — invisible', async () => {
    const { itd, calls } = makeClient([{ id: '1' }]);
    itd.use(crypt());

    await itd.posts.create({ content: 'секрет' }, { encrypt: {} });

    expect(invisible.decode(String(calls[0]?.body.content))).toBe('секрет');
  });

  it('beecrypt шифрует видимым текстом', async () => {
    const { itd, calls } = makeClient([{ id: '1' }]);
    itd.use(crypt());

    await itd.posts.create({ content: 'секрет' }, { encrypt: 'beecrypt' });

    const sent = String(calls[0]?.body.content);
    expect(sent).toMatch(/^[жъЖЪ]+$/);
    expect(beecrypt.decode(sent)).toBe('секрет');
  });

  it('beecrypt отвергает обложку', async () => {
    const { itd } = makeClient([{}]);
    itd.use(crypt());

    await expect(
      itd.posts.create(
        { content: 'секрет' },
        { encrypt: { cipher: 'beecrypt', cover: 'обложка' } },
      ),
    ).rejects.toThrow(/не принимает обложку/);
  });

  it('в ответе узнаёт оба шифра и подписывает, какой сработал', async () => {
    const { itd } = makeClient([
      {
        posts: [
          { id: '1', content: `обычный текст${encodeInvisible('первый')}` },
          { id: '2', content: encodeBeeCrypt('второй') },
          { id: '3', content: 'ничего не спрятано' },
        ],
        pagination: { hasMore: false, nextCursor: null },
      },
    ]);
    itd.use(crypt());

    const page = await itd.posts.list();

    expect(page.items.map((post) => post.secret?.cipher)).toEqual([
      'invisible',
      'beecrypt',
      undefined,
    ]);
    expect(page.items.map((post) => post.secret?.text)).toEqual(['первый', 'второй', undefined]);
  });
});

describe('свой шифр', () => {
  it('подключается вместо встроенного', async () => {
    const rot13 = {
      name: 'rot13',
      encode: (text: string) => `[${text}]`,
      decode: (text: string) =>
        text.startsWith('[') && text.endsWith(']') ? text.slice(1, -1) : null,
    };

    const { itd, calls } = makeClient([{ id: '1' }, { id: '1', content: '[найдено]' }]);
    itd.use(crypt({ ciphers: [rot13] }));

    await itd.posts.create({ content: 'секрет' }, { encrypt: 'rot13' });
    expect(calls[0]?.body.content).toBe('[секрет]');

    const post = await itd.posts.get('1');
    expect(post.secret).toEqual({ cipher: 'rot13', field: 'content', text: 'найдено' });
  });
});
