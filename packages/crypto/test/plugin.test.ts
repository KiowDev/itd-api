import {
  type EventContext,
  ItdClient,
  type NotificationUpdate,
  NotificationUpdateOrigin,
  NotificationUpdateType,
  RetrySafety,
  runEventMiddleware,
  type Span,
} from 'itd-api';
import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_CIPHERS,
  beecrypt,
  type Cipher,
  CipherName,
  type CryptRequestOptions,
  crypt,
  decodeTree,
  encodeBeeCrypt,
  encodeInvisible,
  FRAME_END,
  FRAME_START,
  INVISIBLE_ALPHABET,
} from '../src/index.js';

const cryptoOptions = (options: CryptRequestOptions) => ({ extensions: { crypto: options } });

interface Call {
  url: string;
  method: string;
  body: Record<string, unknown>;
}

function makeClient(
  respond: (call: Call, index: number) => unknown = (call) => ({ id: '1', ...call.body }),
) {
  const calls: Call[] = [];

  const fetchMock = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : {},
    };
    calls.push(call);
    return new Response(JSON.stringify({ data: respond(call, calls.length - 1) }), {
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

function fragmentCipher(id: number, name = `cipher-${id}`): Cipher {
  return {
    id,
    name,
    supportsFragments: true,
    encode: (text) => `[${text}]`,
    decode: (payload) =>
      payload.startsWith('[') && payload.endsWith(']') ? payload.slice(1, -1) : null,
  };
}

describe('реестр cipher', () => {
  it('содержит только публичные встроенные шифры и резервирует их ID', () => {
    expect(Object.values(CipherName)).toEqual(['beecrypt', 'invisible']);
    expect(BUILT_IN_CIPHERS.map((cipher) => cipher.name)).toEqual(['beecrypt', 'invisible']);
    expect(() => crypt({ ciphers: [fragmentCipher(0)] })).toThrow(/зарезервирован/);
  });

  it('проверяет ID, имена и зарезервированные соответствия при подключении', () => {
    expect(() => crypt({ ciphers: [{ ...fragmentCipher(5), id: -1 }] })).toThrow(/safe integer/);
    expect(() => crypt({ ciphers: [fragmentCipher(5), fragmentCipher(5, 'other')] })).toThrow(
      /ID 5/,
    );
    expect(() => crypt({ ciphers: [fragmentCipher(2)] })).not.toThrow();
    expect(() => crypt({ ciphers: [fragmentCipher(5, 'invisible')] })).toThrow(/ID 0/);
    expect(() =>
      crypt({ ciphers: [fragmentCipher(5, 'same'), fragmentCipher(6, 'same')] }),
    ).toThrow(/имя cipher/i);
  });
});

describe('шифрование запроса', () => {
  it('заменяет crypto span на frame и восстанавливает plaintext без мутации входа', async () => {
    const inputSpans: Span[] = [
      { type: 'bold', offset: 6, length: 6 },
      { type: 'crypto', cipher: 'invisible', offset: 6, length: 6 },
    ];
    const input = { content: 'видно секрет видно', spans: inputSpans };
    const { itd, calls } = makeClient();
    itd.use(crypt());

    const post = await itd.posts.create(input);
    const sent = calls[0]?.body;

    expect(input).toEqual({ content: 'видно секрет видно', spans: inputSpans });
    expect(String(sent?.content)).toContain(FRAME_START);
    expect(sent?.spans).toEqual([
      { type: 'bold', offset: 6, length: String(sent?.content).length - 12 },
    ]);
    expect(post.content).toBe(sent?.content);
    expect(post.decoded?.content).toEqual({
      text: input.content,
      spans: [
        { type: 'bold', offset: 6, length: 6 },
        { type: 'crypto', cipher: 'invisible', cipherId: 0, offset: 6, length: 6 },
      ],
    });
  });

  const intersections: Array<[string, Span]> = [
    ['совпадает', { type: 'bold', offset: 4, length: 6 }],
    ['охватывает', { type: 'bold', offset: 2, length: 10 }],
    ['внутри', { type: 'bold', offset: 6, length: 2 }],
    ['пересекает начало', { type: 'bold', offset: 2, length: 4 }],
    ['пересекает конец', { type: 'bold', offset: 8, length: 4 }],
  ];

  for (const [name, visual] of intersections) {
    it(`сохраняет visual span, который ${name} crypto-диапазон`, async () => {
      const { itd, calls } = makeClient();
      itd.use(crypt());
      const cryptoSpan: Span = {
        type: 'crypto',
        cipher: 'invisible',
        offset: 4,
        length: 6,
      };

      const post = await itd.posts.create({ content: '0123456789AB', spans: [visual, cryptoSpan] });

      expect((calls[0]?.body.spans as Span[] | undefined)?.[0]?.type).toBe('bold');
      expect(post.decoded?.content?.text).toBe('0123456789AB');
      expect(post.decoded?.content?.spans).toContainEqual(visual);
      expect(post.decoded?.content?.spans).toContainEqual({
        type: 'crypto',
        cipher: 'invisible',
        cipherId: 0,
        offset: 4,
        length: 6,
      });
    });
  }

  it('поддерживает raw ranges, разные ciphers и числовые ссылки', async () => {
    const custom = fragmentCipher(3, 'brackets');
    const { itd } = makeClient();
    itd.use(crypt({ ciphers: [...BUILT_IN_CIPHERS, custom] }));

    const comment = await itd.posts.comment(
      'p1',
      'видно один и два видно',
      cryptoOptions({
        spans: [
          { cipher: 'invisible', offset: 6, length: 4 },
          { cipher: 3, offset: 13, length: 3 },
        ],
      }),
    );

    expect(comment.decoded?.content?.text).toBe('видно один и два видно');
    expect(comment.decoded?.content?.spans.filter((span) => span.type === 'crypto')).toEqual([
      { type: 'crypto', cipher: 'invisible', cipherId: 0, offset: 6, length: 4 },
      { type: 'crypto', cipher: 'brackets', cipherId: 3, offset: 13, length: 3 },
    ]);
  });

  it('использует metadata custom-операции при отправке и чтении', async () => {
    const { itd } = makeClient();
    itd.use(crypt());
    const chats = itd.install({
      name: 'chats',
      operations: {
        send: {
          method: 'POST',
          retrySafety: RetrySafety.Unsafe,
          annotations: {
            crypto: {
              requestFields: [
                { name: 'message', maxLength: 1000, preservesInvisibleAlphabet: true },
              ],
            },
          },
        },
      },
      setup: (context) => ({
        api: {
          send: (message: string) =>
            context.request('send', {
              path: '/api/chats/1/messages',
              body: { message },
              ...cryptoOptions({ encrypt: 'invisible' }),
            }),
        },
      }),
    });

    const result = (await chats.send('секрет')) as {
      message: string;
      decoded?: { message?: { text: string; spans: unknown[] } };
    };
    expect(result.message).toBe(encodeInvisible('секрет'));
    expect(result.decoded?.message?.text).toBe('секрет');
    expect(result.decoded?.message?.spans).toEqual([
      { type: 'crypto', cipher: 'invisible', cipherId: 0, offset: 0, length: 6 },
    ]);
  });

  it('оставляет whole-field bare, но использует frames для внутренних visual-границ', async () => {
    const bare = makeClient();
    bare.itd.use(crypt());
    const plain = await bare.itd.posts.create(
      { content: 'секрет' },
      cryptoOptions({ encrypt: 'invisible' }),
    );

    expect(bare.calls[0]?.body.content).toBe(encodeInvisible('секрет'));
    expect(String(bare.calls[0]?.body.content)).not.toContain(FRAME_START);
    expect(plain.decoded?.content?.spans).toEqual([
      { type: 'crypto', cipher: 'invisible', cipherId: 0, offset: 0, length: 6 },
    ]);

    const framed = makeClient();
    framed.itd.use(crypt());
    const formatted = await framed.itd.posts.create(
      { content: 'секрет', spans: [{ type: 'bold', offset: 1, length: 3 }] },
      cryptoOptions({ encrypt: 'invisible' }),
    );

    expect(String(framed.calls[0]?.body.content)).toContain(FRAME_START);
    expect(formatted.decoded?.content?.spans).toEqual([
      { type: 'crypto', cipher: 'invisible', cipherId: 0, offset: 0, length: 6 },
      { type: 'bold', offset: 1, length: 3 },
    ]);
  });

  it('отвергает общий spansField у разных полей custom-операции', async () => {
    const { itd, calls } = makeClient();
    itd.use(crypt());
    const chats = itd.install({
      name: 'duplicate-span-fields',
      operations: {
        send: {
          method: 'POST',
          retrySafety: RetrySafety.Unsafe,
          annotations: {
            crypto: {
              requestFields: [
                { name: 'title', spansField: 'spans' },
                { name: 'message', spansField: 'spans' },
              ],
            },
          },
        },
      },
      setup: (context) => ({
        api: {
          send: () =>
            context.request('send', {
              path: '/api/chats/1/messages',
              body: { title: 'тема', message: 'текст', spans: [] },
            }),
        },
      }),
    });

    await expect(chats.send()).rejects.toThrow(/поле разметки «spans» объявлено повторно/);
    expect(calls).toHaveLength(0);
  });

  it('удаляет нулевые обычные spans custom-операции при шифровании', async () => {
    const { itd, calls } = makeClient();
    itd.use(crypt());
    const chats = itd.install({
      name: 'zero-length-spans',
      operations: {
        send: {
          method: 'POST',
          retrySafety: RetrySafety.Unsafe,
          annotations: {
            crypto: {
              requestFields: [{ name: 'message', spansField: 'spans' }],
            },
          },
        },
      },
      setup: (context) => ({
        api: {
          send: () =>
            context.request('send', {
              path: '/api/chats/1/messages',
              body: {
                message: 'секрет',
                spans: [{ type: 'bold', offset: 2, length: 0 }],
              },
              ...cryptoOptions({ spans: [{ cipher: 0, offset: 0, length: 6 }] }),
            }),
        },
      }),
    });

    await chats.send();

    expect(calls[0]?.body.spans).toEqual([]);
  });

  it('склеивает соседние участки одного cipher после чтения', async () => {
    const { itd } = makeClient();
    itd.use(crypt());
    const post = await itd.posts.create(
      { content: 'одиндва' },
      cryptoOptions({
        spans: [
          { cipher: 0, offset: 0, length: 4 },
          { cipher: 0, offset: 4, length: 3 },
        ],
      }),
    );

    expect(post.decoded?.content?.spans).toEqual([
      { type: 'crypto', cipher: 'invisible', cipherId: 0, offset: 0, length: 7 },
    ]);
  });

  it('шифрует displayName и bio независимо whole-field шифром', async () => {
    const { itd, calls } = makeClient();
    itd.use(crypt());

    const profile = await itd.users.updateMe(
      { displayName: 'имя', bio: 'подпись' },
      cryptoOptions({ encrypt: 'beecrypt' }),
    );

    expect(beecrypt.decode(String(calls[0]?.body.displayName))).toBe('имя');
    expect(beecrypt.decode(String(calls[0]?.body.bio))).toBe('подпись');
    expect(profile.decoded?.displayName?.text).toBe('имя');
    expect(profile.decoded?.bio?.text).toBe('подпись');
  });

  it('не применяет invisible к полям без невидимого алфавита', async () => {
    const { itd, calls } = makeClient();
    itd.use(crypt());

    await expect(
      itd.users.updateMe({ displayName: 'имя' }, cryptoOptions({ encrypt: 'invisible' })),
    ).rejects.toThrow(/не сохраняет невидимый алфавит/);
    expect(calls).toHaveLength(0);
  });

  it('проверяет конфликты, диапазоны и семантические spans до сети', async () => {
    const { itd, calls } = makeClient();
    itd.use(crypt());

    await expect(
      itd.posts.create(
        { content: 'секрет' },
        cryptoOptions({ encrypt: 'invisible', spans: [{ cipher: 0, offset: 0, length: 1 }] }),
      ),
    ).rejects.toThrow(/encrypt нельзя/);
    await expect(
      itd.posts.create({ content: 'секрет' }, cryptoOptions({ spans: [] })),
    ).rejects.toThrow(/не может быть пустым/);
    await expect(itd.posts.create({ content: 'секрет' }, cryptoOptions({}))).rejects.toThrow(
      /укажите encrypt или spans/,
    );
    await expect(
      itd.posts.create({
        content: 'секрет',
        spans: [
          { type: 'link', url: 'https://example.com', offset: 0, length: 3 },
          { type: 'crypto', cipher: 0, offset: 1, length: 2 },
        ],
      }),
    ).rejects.toThrow(/семантическим span/);
    await expect(
      itd.posts.create(
        { content: 'секрет' },
        cryptoOptions({
          spans: [
            { cipher: 0, offset: 0, length: 3 },
            { cipher: 0, offset: 2, length: 2 },
          ],
        }),
      ),
    ).rejects.toThrow(/пересекаются/);
    await expect(
      itd.posts.create(
        { content: 'секрет' },
        cryptoOptions({ spans: [{ cipher: 0, offset: 1, length: 0 }] }),
      ),
    ).rejects.toThrow(/непустым/);
    expect(calls).toHaveLength(0);
  });

  it('whole-field beecrypt принимает только внешние visual spans', async () => {
    const full: Span = { type: 'bold', offset: 0, length: 6 };
    const ok = makeClient();
    ok.itd.use(crypt());
    const post = await ok.itd.posts.create(
      { content: 'секрет', spans: [full] },
      cryptoOptions({ encrypt: 'beecrypt' }),
    );
    expect(post.decoded?.content?.spans).toContainEqual(full);

    const bad = makeClient();
    bad.itd.use(crypt());
    await expect(
      bad.itd.posts.create(
        { content: 'секрет', spans: [{ type: 'bold', offset: 1, length: 3 }] },
        cryptoOptions({ encrypt: 'beecrypt' }),
      ),
    ).rejects.toThrow(/внутренними границами/);
  });

  it('проверяет итоговый UTF-16 лимит content', async () => {
    const { itd, calls } = makeClient();
    itd.use(crypt());

    await expect(
      itd.posts.create({ content: 'x'.repeat(251) }, cryptoOptions({ encrypt: 'invisible' })),
    ).rejects.toThrow(/лимит 1000/);
    expect(calls).toHaveLength(0);
  });

  it('отвергает маркеры frame внутри payload custom cipher', async () => {
    const bad: Cipher = {
      id: 5,
      name: 'bad-payload',
      supportsFragments: true,
      encode: () => FRAME_START,
      decode: () => null,
    };
    const { itd } = makeClient();
    itd.use(crypt({ ciphers: [bad] }));

    await expect(
      itd.posts.create(
        { content: 'xy' },
        cryptoOptions({ spans: [{ cipher: 5, offset: 0, length: 1 }] }),
      ),
    ).rejects.toThrow(/содержит маркер frame/);
  });
});

describe('расшифровка', () => {
  it.each([5, 29, 39, 40, 74])('разбирает расширенный cipher ID %i', async (id) => {
    const cipher = fragmentCipher(id);
    const { itd } = makeClient();
    itd.use(crypt({ ciphers: [cipher] }));

    const post = await itd.posts.create(
      { content: 'до секрет после' },
      cryptoOptions({ spans: [{ cipher: id, offset: 3, length: 6 }] }),
    );

    expect(post.decoded?.content?.text).toBe('до секрет после');
    expect(post.decoded?.content?.spans).toContainEqual({
      type: 'crypto',
      cipher: `cipher-${id}`,
      cipherId: id,
      offset: 3,
      length: 6,
    });
  });

  it('оставляет повреждённые и неизвестные frames raw', () => {
    const id0 = INVISIBLE_ALPHABET[0] ?? '';
    const id3 = INVISIBLE_ALPHABET[3] ?? '';
    const id4 = INVISIBLE_ALPHABET[4] ?? '';
    const missingEnd = FRAME_START + id0 + encodeInvisible('секрет');
    const unknown = `${FRAME_START + id4}text${encodeInvisible('секрет')}${FRAME_END}`;
    const rejected = `${FRAME_START + id3}bad${FRAME_END}`;
    const rejecting: Cipher = { ...fragmentCipher(3, 'rejecting'), decode: () => null };

    expect(decodeTree({ content: missingEnd }, BUILT_IN_CIPHERS)).toEqual({ content: missingEnd });
    expect(decodeTree({ content: unknown }, BUILT_IN_CIPHERS)).toEqual({ content: unknown });
    expect(decodeTree({ content: rejected }, [...BUILT_IN_CIPHERS, rejecting])).toEqual({
      content: rejected,
    });
  });

  it.each([1, 2, 3])('пересинхронизируется после %i посторонних U+206F перед frame', (count) => {
    const prefix = (INVISIBLE_ALPHABET[5] ?? '').repeat(count);
    const frame =
      FRAME_START + (INVISIBLE_ALPHABET[0] ?? '') + encodeInvisible('секрет') + FRAME_END;
    const result = decodeTree({ content: prefix + frame }, BUILT_IN_CIPHERS);

    expect(result.decoded?.content?.text).toBe(`${prefix}секрет`);
    expect(result.decoded?.content?.spans).toContainEqual({
      type: 'crypto',
      cipher: 'invisible',
      cipherId: 0,
      offset: count,
      length: 6,
    });
  });

  it('пересинхронизируется перед frame с видимым payload custom cipher', () => {
    const cipher = fragmentCipher(3, 'brackets');
    const prefix = INVISIBLE_ALPHABET[5] ?? '';
    const frame = `${FRAME_START}${INVISIBLE_ALPHABET[3] ?? ''}[секрет]${FRAME_END}`;
    const result = decodeTree({ content: prefix + frame }, [cipher]);

    expect(result.decoded?.content?.text).toBe(`${prefix}секрет`);
  });

  it('читает прежний bare whole-field invisible как обычный invisible', () => {
    const wire = encodeInvisible('я');
    const result = decodeTree({ content: wire }, BUILT_IN_CIPHERS);

    expect(result.content).toBe(wire);
    expect(result.decoded?.content).toEqual({
      text: 'я',
      spans: [{ type: 'crypto', cipher: 'invisible', cipherId: 0, offset: 0, length: 1 }],
    });
  });

  it('не распознаёт legacy invisible с видимой обложкой автоматически', () => {
    const content = `обложка${encodeInvisible('секрет')}`;
    expect(decodeTree({ content }, BUILT_IN_CIPHERS)).toEqual({ content });
  });

  it('читает прежний whole-field beecrypt', () => {
    const wire = encodeBeeCrypt('секрет');
    const result = decodeTree({ displayName: wire }, BUILT_IN_CIPHERS);

    expect(result.decoded?.displayName).toEqual({
      text: 'секрет',
      spans: [{ type: 'crypto', cipher: 'beecrypt', cipherId: 1, offset: 0, length: 6 }],
    });
  });

  it('возвращает copy-on-write результат и не загрязняет raw cache value', () => {
    const wire =
      FRAME_START + (INVISIBLE_ALPHABET[0] ?? '') + encodeInvisible('секрет') + FRAME_END;
    const raw = Object.freeze({ content: wire, nested: Object.freeze({ value: 1 }) });
    const result = decodeTree(raw, BUILT_IN_CIPHERS);

    expect(result).not.toBe(raw);
    expect(raw).not.toHaveProperty('decoded');
    expect(result.content).toBe(wire);
    expect(result.decoded?.content?.text).toBe('секрет');
  });

  it('не копирует дерево без находок и сохраняет неизменённые ветви', () => {
    const untouched = { id: 'same' };
    const plain = { content: 'обычный текст', untouched };
    expect(decodeTree(plain, BUILT_IN_CIPHERS)).toBe(plain);

    const encrypted = {
      items: [{ content: encodeBeeCrypt('секрет') }],
      untouched,
    };
    const decoded = decodeTree(encrypted, BUILT_IN_CIPHERS);
    expect(decoded).not.toBe(encrypted);
    expect(decoded.items).not.toBe(encrypted.items);
    expect(decoded.untouched).toBe(untouched);
  });

  it('не переносит нулевые серверные spans в decoded', () => {
    const wire =
      FRAME_START + (INVISIBLE_ALPHABET[0] ?? '') + encodeInvisible('секрет') + FRAME_END;
    const result = decodeTree(
      { content: wire, spans: [{ type: 'bold', offset: 5, length: 0 }] },
      BUILT_IN_CIPHERS,
    );

    expect(result.decoded?.content?.spans).toEqual([
      { type: 'crypto', cipher: 'invisible', cipherId: 0, offset: 0, length: 6 },
    ]);
  });
});

describe('события', () => {
  it('передаёт дальше расшифрованную копию нормализованного update', async () => {
    const preview = encodeBeeCrypt('событие');
    const update: NotificationUpdate = {
      type: NotificationUpdateType.Notification,
      data: {
        notification: {
          id: 'notification-1',
          type: 'post_comment',
          rawType: 'comment',
          entityId: 'comment-1',
          parentEntityId: 'post-1',
          isRead: false,
          actors: [],
          count: 1,
          preview,
          createdAt: '2026-08-12T00:00:00.000Z',
          updatedAt: '2026-08-12T00:00:00.000Z',
          raw: {},
        },
        unreadCount: undefined,
        sound: false,
      },
    };
    const context: EventContext<NotificationUpdate> = {
      update,
      stream: {},
      raw: undefined,
      origin: NotificationUpdateOrigin.Stream,
    };

    await runEventMiddleware([crypt().middleware()], context, async () => {
      expect(context.update).not.toBe(update);
      expect(context.update.data.notification.decoded?.preview?.text).toBe('событие');
    });
    expect(update.data.notification).not.toHaveProperty('decoded');
  });
});
