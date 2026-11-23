import {
  ChatUpdateType,
  type EventContext,
  ItdClient,
  type NotificationUpdate,
  NotificationUpdateOrigin,
  NotificationUpdateType,
  RetrySafety,
  runEventMiddleware,
  type Span,
  type WebSocketLike,
} from 'itd-api';
import { describe, expect, it, vi } from 'vitest';
import { FRAME_START } from '../src/frames/frame.constants.js';
import {
  BUILT_IN_CIPHERS,
  beecrypt,
  type Cipher,
  CipherName,
  type CryptRequestOptions,
  crypt,
  encodeBeeCrypt,
  encodeInvisible,
} from '../src/index.js';
import { fragmentCipher } from './helpers/cipher.fixtures.js';

const cryptoOptions = (options: CryptRequestOptions) => ({ extensions: { crypto: options } });

interface Call {
  url: string;
  method: string;
  body: Record<string, unknown>;
}

function makeClient(
  respond: (call: Call, index: number) => unknown = (call) => ({ id: '1', ...call.body }),
  webSocketImpl?: WebSocketLike,
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
    events: { chats: { webSocketImpl } },
    mode: 'server',
  });
  return { itd, calls };
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
  it('расшифровывает исходный пост внутри репоста', async () => {
    const { itd, calls } = makeClient((call, index) =>
      index === 0
        ? { id: 'root', ...call.body }
        : {
            id: 'repost',
            content: '',
            spans: [],
            originalPost: {
              id: 'root',
              content: calls[0]?.body.content,
              spans: calls[0]?.body.spans,
              createdAt: '2026-10-04 22:32:04+03',
            },
          },
    );
    itd.use(crypt());
    await itd.posts.create({
      content: 'видно секрет',
      spans: [{ type: 'crypto', cipher: 'invisible', offset: 6, length: 6 }],
    });

    const post = await itd.posts.get('repost');

    expect(post.originalPost?.decoded?.content?.text).toBe('видно секрет');
    expect(post.originalPost?.createdAt).toBe('2026-10-04T19:32:04.000Z');
  });

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

  it.each(['message', 'text'])('использует metadata custom-операции для %s', async (field) => {
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
                {
                  name: field,
                  spansField: 'spans',
                  maxLength: 1000,
                  preservesInvisibleAlphabet: true,
                },
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
              body: {
                [field]: message,
                spans: [{ type: 'bold', offset: 0, length: message.length }],
              },
              ...cryptoOptions({ encrypt: 'invisible' }),
            }),
        },
      }),
    });

    expect(await chats.send('секрет')).toMatchObject({
      [field]: encodeInvisible('секрет'),
      decoded: {
        [field]: {
          text: 'секрет',
          spans: [
            { type: 'bold', offset: 0, length: 6 },
            { type: 'crypto', cipher: 'invisible', cipherId: 0, offset: 0, length: 6 },
          ],
        },
      },
    });
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
});

describe('чаты', () => {
  it('шифрует сообщения и сохраняет форматирование и вложенный пост', async () => {
    const { itd, calls } = makeClient((call) =>
      call.method === 'GET'
        ? {
            messages: [
              {
                message_id: 'm1',
                sender_id: 'u1',
                created_at: '2026-11-20T00:00:00Z',
                text: calls[0]?.body.text,
                entities: calls[0]?.body.entities,
                reply_to: { message_id: 'm0', sender_id: 'u1', text: encodeInvisible('ответ') },
              },
            ],
          }
        : { message_id: 'm1', chat_id: 'c1' },
    );
    try {
      itd.use(crypt());
      await itd.chats.sendMessage('c1', {
        text: 'до секрет',
        entities: [
          { type: 'post', postId: 'p1' },
          { type: 'code', offset: 3, length: 6 },
          { type: 'crypto', cipher: CipherName.Invisible, offset: 3, length: 6 },
        ],
      });
      await itd.chats.sendMessageToUser(
        'u1',
        { text: 'секрет' },
        cryptoOptions({ encrypt: CipherName.Invisible }),
      );
      await itd.chats.editMessage(
        'c1',
        'm1',
        { text: 'секрет' },
        cryptoOptions({ spans: [{ cipher: CipherName.Invisible, offset: 0, length: 6 }] }),
      );

      expect(calls[0]?.body.text).not.toContain('секрет');
      expect(calls[0]?.body.entities).toEqual([
        { type: 'post', post_id: 'p1' },
        { type: 'code', offset: 3, length: String(calls[0]?.body.text).length - 3 },
      ]);
      expect(calls[1]?.body.text).toBe(encodeInvisible('секрет'));
      expect(calls[2]?.body.text).toBe(encodeInvisible('секрет'));

      const { messages } = await itd.chats.messages('c1');
      expect(messages[0]?.text).toBe(calls[0]?.body.text);
      expect(messages[0]?.decoded?.text?.text).toBe('до секрет');
      expect(messages[0]?.decoded?.text?.spans).toContainEqual({
        type: 'code',
        offset: 3,
        length: 6,
      });
      expect(messages[0]?.replyTo?.decoded?.text?.text).toBe('ответ');
    } finally {
      await itd.close();
    }
  });

  it('отклоняет crypto без координат и пересечение с текстовой ссылкой до отправки', async () => {
    const { itd, calls } = makeClient();
    try {
      itd.use(crypt());
      await expect(
        itd.chats.sendMessage('c1', {
          text: 'секрет',
          entities: [{ type: 'crypto', cipher: CipherName.Invisible }],
        }),
      ).rejects.toThrow(/offset и length/);
      await expect(
        itd.chats.sendMessage(
          'c1',
          {
            text: 'секрет',
            entities: [{ type: 'text_link', offset: 0, length: 6, url: 'https://example.com' }],
          },
          cryptoOptions({ encrypt: CipherName.Invisible }),
        ),
      ).rejects.toThrow(/text_link/);
      await expect(
        itd.request({
          method: 'POST',
          path: '/api/v1/messenger/chats/c1/messages',
          body: {
            text: 'секрет',
            entities: [{ type: 'crypto', cipher: CipherName.Invisible, offset: 0, length: 6 }],
          },
        }),
      ).rejects.toThrow(/не принимает текстовые поля/);
      expect(calls).toHaveLength(0);
    } finally {
      await itd.close();
    }
  });
});

describe('события', () => {
  it('передаёт слушателю чата расшифрованное сообщение из WebSocket', async () => {
    let socket: TestSocket | undefined;
    class TestSocket extends EventTarget {
      readyState = 0;
      constructor() {
        super();
        socket = this;
      }
      send() {}
      close() {
        this.readyState = 3;
      }
    }
    const { itd } = makeClient(undefined, TestSocket);
    try {
      const events = itd.chats.events;
      events.use(crypt());
      const listener = vi.fn();
      events.on('update', listener);
      const connecting = events.connect();
      await vi.waitFor(() => expect(socket).toBeDefined());
      if (!socket) throw new Error('WebSocket не создан');
      socket.readyState = 1;
      socket.dispatchEvent(new Event('open'));
      await connecting;

      const text = encodeInvisible('событие');
      socket.dispatchEvent(
        new MessageEvent('message', {
          data: JSON.stringify({
            type: ChatUpdateType.NewMessage,
            chat_id: 'c1',
            message: { message_id: 'm1', sender_id: 'u1', text },
          }),
        }),
      );
      await vi.waitFor(() =>
        expect(listener).toHaveBeenCalledWith(
          expect.objectContaining({
            message: expect.objectContaining({
              text,
              decoded: { text: expect.objectContaining({ text: 'событие' }) },
            }),
          }),
        ),
      );
    } finally {
      await itd.close();
    }
  });

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
          title: null,
          eventId: null,
          expiresAt: null,
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
