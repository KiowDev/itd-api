import { ChatUpdateType, ItdClient, type Logger, MemoryKeyValueStore } from 'itd-api';
import { describe, expect, it, vi } from 'vitest';
import { hydrateClient } from '../../hydrate/src/index.js';
import {
  ChatBot,
  ChatBotError,
  ChatBotFilter,
  ChatContext,
  type SessionFlavor,
  session,
} from '../src/index.js';

function setup(fetch: typeof globalThis.fetch = vi.fn(), logger?: Logger) {
  const sockets: TestSocket[] = [];

  class TestSocket extends EventTarget {
    readyState = 0;

    constructor() {
      super();
      sockets.push(this);
    }

    open(): void {
      this.readyState = 1;
      this.dispatchEvent(new Event('open'));
    }

    update(update: object): void {
      this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(update) }));
    }

    send(): void {}

    close(): void {
      this.readyState = 3;
      this.dispatchEvent(Object.assign(new Event('close'), { code: 1000, wasClean: true }));
    }
  }

  const itd = new ItdClient({
    baseUrl: 'https://itd.test',
    auth: 'test-token',
    fetch,
    retry: false,
    rateLimit: false,
    logger,
    events: { chats: { webSocketImpl: TestSocket } },
  });
  const nextSocket = (index = 0) =>
    vi.waitFor(() => {
      const socket = sockets[index];
      if (!socket) throw new Error('WebSocket ещё не создан');
      return socket;
    });
  return { itd, nextSocket, sockets };
}

function message(text: string, id = 'm1') {
  return { message_id: id, sender_id: 'u1', created_at: '2026-11-20 00:00:00', text };
}

describe('ChatBot', () => {
  it('пишет необработанные ошибки и ошибки bot.catch в логгер клиента', async () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const { itd, nextSocket } = setup(undefined, logger);
    const bot = new ChatBot(hydrateClient(itd));
    const middlewareError = new Error('Ошибка команды');
    const catchError = new Error('Ошибка bot.catch');
    bot.command('fail', () => {
      throw middlewareError;
    });

    try {
      const starting = bot.start();
      const socket = await nextSocket();
      socket.open();
      await starting;
      socket.update({ type: ChatUpdateType.NewMessage, chat_id: 'c1', message: message('/fail') });
      await vi.waitFor(() => expect(logger.error).toHaveBeenCalledTimes(1));
      expect(logger.error).toHaveBeenLastCalledWith(
        'Ошибка обработчика чат-бота',
        expect.any(ChatBotError),
      );
      expect(logger.error.mock.calls[0]?.[1]).toMatchObject({
        cause: middlewareError,
        context: { chatId: 'c1' },
      });

      const onError = vi.fn(() => {
        throw catchError;
      });
      bot.catch(onError);
      socket.update({ type: ChatUpdateType.NewMessage, chat_id: 'c2', message: message('/fail') });
      await vi.waitFor(() => expect(logger.error).toHaveBeenCalledTimes(2));
      expect(onError).toHaveBeenCalledWith(
        middlewareError,
        expect.objectContaining({ chatId: 'c2' }),
      );
      expect(logger.error).toHaveBeenLastCalledWith(
        'Ошибка обработчика ошибок чат-бота',
        expect.objectContaining({ cause: catchError }),
      );
    } finally {
      bot.stop();
      await bot.drain();
      await itd.close();
    }
  });

  it('обрабатывает одиночные и пакетные сообщения, пропуская команды от самого бота', async () => {
    const sent: unknown[] = [];
    const fetch = vi.fn<typeof globalThis.fetch>(async (url, request) => {
      expect(new URL(String(url)).pathname).toBe('/api/v1/messenger/chats/c1/messages');
      expect(request?.method).toBe('POST');
      sent.push(JSON.parse(String(request?.body)));
      return Response.json({ message_id: 'sent' });
    });
    const { itd, nextSocket, sockets } = setup(fetch);
    const bot = new ChatBot(itd);
    const order: string[] = [];
    const heard = vi.fn();
    const attached = vi.fn();
    bot.use(async (ctx, next) => {
      order.push(`до ${ctx.message?.messageId}`);
      await next();
      order.push(`после ${ctx.message?.messageId}`);
    });
    bot.command('echo', (ctx) => ctx.replyTo(ctx.args, { attachmentIds: ['f1'] }));
    bot.hears(/^найди (.+)$/g, (ctx) => heard(ctx.match[1]));
    bot.on(ChatBotFilter.MessageAttachment, (ctx) => attached(ctx.message.messageId));
    try {
      const first = bot.start();
      expect(bot.start()).toBe(first);
      const socket = await nextSocket();
      socket.open();
      await first;
      await bot.start();
      socket.update({
        type: ChatUpdateType.NewMessage,
        chat_id: 'c1',
        message: message('/echo привет'),
      });
      socket.update({
        type: ChatUpdateType.NewMessages,
        chat_id: 'c1',
        messages: [
          message('найди кота', 'm2'),
          message('найди пса', 'm3'),
          { ...message('', 'm4'), attachments: [{ fileId: 'f1', url: '/file' }] },
        ],
      });
      socket.update({
        type: ChatUpdateType.OwnMessages,
        chat_id: 'c1',
        messages: [message('/echo свой', 'm5')],
      });
      await vi.waitFor(() => expect(order.at(-1)).toBe('после m5'));
      expect(order).toEqual(
        ['m1', 'm2', 'm3', 'm4', 'm5'].flatMap((id) => [`до ${id}`, `после ${id}`]),
      );
      expect(heard.mock.calls).toEqual([['кота'], ['пса']]);
      expect(attached).toHaveBeenCalledExactlyOnceWith('m4');
      expect(sent).toEqual([{ text: 'привет', reply_to_id: 'm1', attachments: ['f1'] }]);
      expect(sockets).toHaveLength(1);
    } finally {
      bot.stop();
      await bot.drain();
      await itd.close();
    }
  });

  it('делегирует чтение пропущенных событий клиенту и продолжает после ошибки команды', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (url) => {
      const since = new URL(String(url)).searchParams.get('since');
      return Response.json({
        events:
          since === '10'
            ? [
                {
                  type: ChatUpdateType.NewMessage,
                  chat_id: 'c1',
                  event_seq: 11,
                  message: message('/fail'),
                },
              ]
            : [],
        next_event_seq: 11,
        reset_required: false,
      });
    });
    const { itd, nextSocket } = setup(fetch);
    const bot = new ChatBot(itd);
    const error = new Error('ошибка тестовой команды');
    const report = vi.fn();
    const passed = vi.fn();
    bot.catch((failure, context) => report(failure, context.chatId));
    bot.command('fail', () => {
      throw error;
    });
    bot.command('ok', passed);
    try {
      const starting = bot.start(10);
      const socket = await nextSocket();
      socket.open();
      await starting;
      socket.update({
        type: ChatUpdateType.NewMessage,
        chat_id: 'c1',
        event_seq: 12,
        message: message('/ok'),
      });
      await vi.waitFor(() => expect(passed).toHaveBeenCalledOnce());
      expect(report).toHaveBeenCalledExactlyOnceWith(error, 'c1');
      expect(fetch).toHaveBeenCalledTimes(2);
    } finally {
      bot.stop();
      await bot.drain();
      await itd.close();
    }
  });

  it('сохраняет состояние чата и ждёт начатый обработчик при остановке', async () => {
    type State = { count: number };
    const storage = new MemoryKeyValueStore<State>();
    const { itd, nextSocket } = setup();
    class Context extends ChatContext<typeof itd> {
      session: State | undefined;
    }
    const bot = new ChatBot(itd, { createContext: (...args) => new Context(...args) });
    const entered = vi.fn();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    bot.use(session({ storage, initial: () => ({ count: 0 }) }));
    bot.command('count', async (ctx) => {
      expect(ctx).toBeInstanceOf(Context);
      ctx.session = { count: (ctx.session?.count ?? 0) + 1 };
      entered();
      await gate;
    });
    try {
      const starting = bot.start();
      const socket = await nextSocket();
      socket.open();
      await starting;
      socket.update({
        type: ChatUpdateType.NewMessages,
        chat_id: 'c1',
        messages: [message('/count'), message('/count', 'm2')],
      });
      await vi.waitFor(() => expect(entered).toHaveBeenCalledOnce());
      const stopped = vi.fn();
      bot.stop();
      const stopping = bot.drain().then(stopped);
      expect(stopped).not.toHaveBeenCalled();
      release();
      await stopping;
      expect(entered).toHaveBeenCalledOnce();
      expect(await storage.get('chat-bot:c1')).toEqual({ count: 1 });

      const restarting = bot.start();
      const next = await nextSocket(1);
      next.open();
      await restarting;
      next.update({
        type: ChatUpdateType.NewMessage,
        chat_id: 'c1',
        message: message('/count', 'm3'),
      });
      await vi.waitFor(async () => expect(await storage.get('chat-bot:c1')).toEqual({ count: 2 }));
    } finally {
      release();
      bot.stop();
      await bot.drain();
      await itd.close();
    }
  });

  it('отбрасывает очередь и отменяет ответы начатого обработчика при смене сессии', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const { itd, nextSocket } = setup(fetch);
    const bot = new ChatBot(itd);
    const queued = vi.fn();
    const entered = vi.fn();
    const received = vi.fn();
    const { promise, resolve } = withGate();
    bot.stream.on('update', received);
    bot.command('hold', async (ctx) => {
      entered();
      await promise;
      await expect(Promise.resolve().then(() => ctx.reply('Старый ответ'))).rejects.toMatchObject({
        name: 'ItdAbortError',
      });
    });
    bot.command('queued', queued);
    try {
      const started = bot.start();
      const socket = await nextSocket();
      socket.open();
      await started;
      socket.update({ type: ChatUpdateType.NewMessage, chat_id: 'c1', message: message('/hold') });
      await vi.waitFor(() => expect(entered).toHaveBeenCalledOnce());
      socket.update({
        type: ChatUpdateType.NewMessage,
        chat_id: 'c1',
        message: message('/queued'),
      });
      await vi.waitFor(() => expect(received).toHaveBeenCalledTimes(2));
      await itd.setSession({ accessToken: 'another-test-token' });
      expect(socket.readyState).toBe(3);
      resolve();
      await bot.drain();
      expect(fetch).not.toHaveBeenCalled();
      expect(queued).not.toHaveBeenCalled();

      const restarted = bot.start();
      const next = await nextSocket(1);
      next.open();
      await restarted;
      next.update({ type: ChatUpdateType.NewMessage, chat_id: 'c1', message: message('/queued') });
      await vi.waitFor(() => expect(queued).toHaveBeenCalledOnce());
    } finally {
      resolve();
      bot.stop();
      await bot.drain();
      await itd.close();
    }
  });

  it('останавливается из команды и сохраняет типы гидратированного клиента', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (url) => {
      const path = new URL(String(url)).pathname;
      if (path === '/api/users/u1') return Response.json({ id: 'u1', username: 'alice' });
      if (path.endsWith('/chats/c1'))
        return Response.json({ chat_id: 'c1', chat_type: 0, unread_count: 0 });
      return Response.json({ messages: [message('История')] });
    });
    const { itd, nextSocket } = setup(fetch);
    const bot = new ChatBot(hydrateClient(itd));
    const done = vi.fn();
    bot.command('stop', async (ctx) => {
      if (!ctx.senderId || !ctx.chatId) throw new Error('У сообщения нет автора или чата');
      const author = await ctx.itd.users.get(ctx.senderId, { signal: ctx.signal });
      expect(author.follow).toBeTypeOf('function');
      const chat = await ctx.chats.get(ctx.chatId, { signal: ctx.signal });
      const { messages } = await chat.getMessages({}, { signal: ctx.signal });
      expect(messages[0]?.reply).toBeTypeOf('function');
      await bot.stop();
      done();
    });
    try {
      const started = bot.start();
      const socket = await nextSocket();
      socket.open();
      await started;
      expect(bot.stream).toBe(itd.chats.events);
      socket.update({ type: ChatUpdateType.NewMessage, chat_id: 'c1', message: message('/stop') });
      await vi.waitFor(() => expect(done).toHaveBeenCalledOnce());
      await bot.drain();
      expect(socket.readyState).toBe(3);
      expect(fetch.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual([
        '/api/users/u1',
        '/api/v1/messenger/chats/c1',
        '/api/v1/messenger/chats/c1/messages',
      ]);
    } finally {
      bot.stop();
      await bot.drain();
      await itd.close();
    }
  });

  it('при resetRequired обрабатывает принятые события и продолжает чтение с новой позиции', async () => {
    const requests: string[] = [];
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = new URL(String(input));
      const since = url.searchParams.get('since');
      requests.push(since ?? url.pathname);
      if (url.pathname.endsWith('/chats')) return Response.json({ chats: [], event_seq: 20 });
      if (since === '10') {
        return Response.json({
          events: [11, 12].map((seq) => ({
            type: ChatUpdateType.NewMessage,
            chat_id: 'c1',
            event_seq: seq,
            message: message('/hello', String(seq)),
          })),
          next_event_seq: 12,
        });
      }
      return Response.json({ events: [], reset_required: since === '12', next_event_seq: 20 });
    });
    const { itd, nextSocket } = setup(fetch);
    const bot = new ChatBot(itd);
    const { promise, resolve } = withGate();
    const completed = vi.fn();
    const command = vi.fn(async (ctx: ChatContext) => {
      if (ctx.update.eventSeq === 11) await promise;
      completed(ctx.update.eventSeq, ctx.signal?.aborted);
    });
    bot.command('hello', command);
    try {
      const starting = bot.start(10);
      const first = await nextSocket();
      first.open();
      const second = await nextSocket(1);
      expect(first.readyState).toBe(3);
      second.open();
      await starting;
      second.update({
        type: ChatUpdateType.NewMessage,
        chat_id: 'c1',
        event_seq: 21,
        message: message('/hello'),
      });
      expect(command.mock.calls.map(([ctx]) => ctx.update.eventSeq)).toEqual([11]);
      resolve();
      await vi.waitFor(() =>
        expect(completed.mock.calls).toEqual([
          [11, false],
          [12, false],
          [21, false],
        ]),
      );
      expect(requests).toEqual(['10', '12', '/api/v1/messenger/chats', '20']);
    } finally {
      resolve();
      bot.stop();
      await bot.drain();
      await itd.close();
    }
  });

  it('обрабатывает разные чаты параллельно в пределах concurrency и сохраняет порядок в чате', async () => {
    const { itd, nextSocket } = setup();
    const bot = new ChatBot(itd, { concurrency: 2 });
    const first = withGate();
    const second = withGate();
    const handled = vi.fn(async (id: string) => {
      if (id === 'm1') await first.promise;
      if (id === 'm3') await second.promise;
    });
    bot.on(ChatBotFilter.Message, (ctx) => handled(ctx.message.messageId));
    try {
      const starting = bot.start();
      const socket = await nextSocket();
      socket.open();
      await starting;
      for (const [chatId, id] of [
        ['c1', 'm1'],
        ['c1', 'm2'],
        ['c2', 'm3'],
        ['c3', 'm4'],
      ] as const) {
        socket.update({
          type: ChatUpdateType.NewMessage,
          chat_id: chatId,
          message: message('Привет', id),
        });
      }
      await vi.waitFor(() => expect(handled.mock.calls).toEqual([['m1'], ['m3']]));
      second.resolve();
      await vi.waitFor(() => expect(handled.mock.calls).toEqual([['m1'], ['m3'], ['m4']]));
      first.resolve();
      await bot.drain();
      expect(handled.mock.calls).toEqual([['m1'], ['m3'], ['m4'], ['m2']]);
    } finally {
      first.resolve();
      second.resolve();
      bot.stop();
      await bot.drain();
      await itd.close();
    }
  });

  it.each([
    { options: undefined, limit: 256 },
    { options: { maxPendingUpdates: 300 }, limit: 300 },
  ])('догружает журнал после переполнения (лимит $limit)', async ({ options, limit }) => {
    const accepted = limit + 1;
    const last = 2 * accepted + 1;
    const positions: number[] = [];
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      const since = Number(new URL(String(input)).searchParams.get('since'));
      positions.push(since);
      return Response.json({
        events: Array.from({ length: last - since }, (_, i) => {
          const seq = since + i + 1;
          return {
            type: ChatUpdateType.NewMessage,
            chat_id: 'c1',
            event_seq: seq,
            message: message('Привет', String(seq)),
          };
        }),
        next_event_seq: last,
      });
    });
    const { itd, nextSocket } = setup(fetch);
    const bot = new ChatBot(itd, options);
    const handled = vi.fn();
    bot.use((ctx) => handled(ctx.update.eventSeq));
    try {
      const started = bot.start(0);
      (await nextSocket()).open();
      (await nextSocket(1)).open();
      (await nextSocket(2)).open();
      await started;
      await bot.drain();
      expect(positions).toEqual([0, accepted, 2 * accepted, last]);
      expect(handled.mock.calls).toEqual(Array.from({ length: last }, (_, i) => [i + 1]));
    } finally {
      bot.stop();
      await bot.drain();
      await itd.close();
    }
  });

  it.each([false, true])(
    'пауза при заполнении очереди (смена аккаунта: %s)',
    async (switchAccount) => {
      const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
        const since = new URL(String(input)).searchParams.get('since');
        return Response.json({
          events:
            since === '2'
              ? [
                  {
                    type: ChatUpdateType.NewMessage,
                    chat_id: 'c1',
                    event_seq: 3,
                    message: message('/hello', '3'),
                  },
                ]
              : [],
          next_event_seq: 3,
        });
      });
      const { itd, nextSocket, sockets } = setup(fetch);
      const bot = new ChatBot(itd, { maxPendingUpdates: 1 });
      const gate = withGate();
      const handled = vi.fn(async (seq: number | null | undefined) => {
        if (seq === 1) await gate.promise;
      });
      bot.use((ctx) => handled(ctx.update.eventSeq));

      try {
        const started = bot.start();
        const socket = await nextSocket();
        socket.open();
        await started;
        for (const seq of [1, 2, 3]) {
          socket.update({
            type: ChatUpdateType.NewMessage,
            chat_id: 'c1',
            event_seq: seq,
            message: message('/hello', String(seq)),
          });
        }
        await vi.waitFor(() => expect(socket.readyState).toBe(3));
        expect(sockets).toHaveLength(1);
        expect(handled.mock.calls).toEqual([[1]]);
        if (switchAccount) {
          const stopped = expect(bot.start()).rejects.toMatchObject({ name: 'ItdAbortError' });
          await itd.setSession({ accessToken: 'another-test-token' });
          gate.resolve();
          await stopped;
          expect(sockets).toHaveLength(1);
          expect(fetch).not.toHaveBeenCalled();
          expect(handled.mock.calls).toEqual([[1]]);
        } else {
          gate.resolve();
          const resumed = await nextSocket(1);
          const continuing = bot.start();
          resumed.open();
          await continuing;
          await bot.drain();
          expect(new URL(String(fetch.mock.calls[0]?.[0])).searchParams.get('since')).toBe('2');
          expect(handled.mock.calls).toEqual([[1], [2], [3]]);
        }
      } finally {
        gate.resolve();
        bot.stop();
        await bot.drain();
        await itd.close();
      }
    },
  );

  it('при переполнении без позиции в журнале завершает принятую работу и сообщает об ошибке', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({
        events: [1, 2, undefined].map((seq) => ({
          type: ChatUpdateType.NewMessage,
          chat_id: 'c1',
          event_seq: seq,
          message: message('/hello'),
        })),
        next_event_seq: 2,
      }),
    );
    const { itd, nextSocket, sockets } = setup(fetch);
    const bot = new ChatBot(itd, { maxPendingUpdates: 1 });
    const handled = vi.fn();
    bot.use((ctx) => handled(ctx.update.eventSeq));
    try {
      const failure = expect(bot.start(0)).rejects.toThrow('Не удалось определить позицию');
      (await nextSocket()).open();
      await failure;
      expect(sockets).toHaveLength(1);
      expect(handled.mock.calls).toEqual([[1], [2]]);
    } finally {
      bot.stop();
      await bot.drain();
      await itd.close();
    }
  });

  it('прекращает восстановление при смене аккаунта, пока загружается список чатов', async () => {
    const entered = vi.fn();
    const gate = withGate();
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      if (String(input).includes('/updates?')) {
        return Response.json({ events: [], reset_required: true, next_event_seq: 20 });
      }
      entered();
      await gate.promise;
      return Response.json({ chats: [], event_seq: 20 });
    });
    const { itd, nextSocket, sockets } = setup(fetch);
    const bot = new ChatBot(itd);
    try {
      const failure = expect(bot.start(10)).rejects.toMatchObject({ name: 'ItdAbortError' });
      (await nextSocket()).open();
      await vi.waitFor(() => expect(entered).toHaveBeenCalledOnce());
      await itd.setSession({ accessToken: 'another-test-token' });
      await failure;
      gate.resolve();
      await bot.drain();
      expect(sockets).toHaveLength(1);
    } finally {
      gate.resolve();
      bot.stop();
      await bot.drain();
      await itd.close();
    }
  });

  it('останавливается, если сервер повторно просит сброс после загрузки новой позиции', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) =>
      String(input).includes('/updates?')
        ? Response.json({ events: [], reset_required: true, next_event_seq: 20 })
        : Response.json({ chats: [], event_seq: 20 }),
    );
    const { itd, nextSocket, sockets } = setup(fetch);
    const bot = new ChatBot(itd);
    try {
      const failure = expect(bot.start(10)).rejects.toMatchObject({ name: 'ItdStateError' });
      (await nextSocket()).open();
      (await nextSocket(1)).open();
      await failure;
      expect(sockets).toHaveLength(2);
      expect(sockets[1]?.readyState).toBe(3);
      expect(fetch).toHaveBeenCalledTimes(3);
    } finally {
      bot.stop();
      await bot.drain();
      await itd.close();
    }
  });

  it('загружает файлы до отправки текста и добавляет их к уже готовым вложениям', async () => {
    let uploaded = 0;
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, request) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/init')) return Response.json({ uploadId: `upload-${++uploaded}` });
      if (path.endsWith('/part/0')) return new Response(null, { status: 204 });
      if (path.endsWith('/finalize')) return Response.json({ fileId: `file-${uploaded}` });
      expect(path).toBe('/api/v1/messenger/chats/c1/messages');
      expect(JSON.parse(String(request?.body))).toEqual({
        text: 'Привет',
        reply_to_id: 'm1',
        attachments: ['existing', 'file-1', 'file-2'],
      });
      return Response.json({ message_id: 'sent' });
    });
    const { itd } = setup(fetch);
    const ctx = new ChatContext(itd, { type: ChatUpdateType.NewMessage, chatId: 'c1' });
    try {
      await expect(
        ctx.sendWithAttachments({ text: 'Привет', replyToId: 'm1', attachmentIds: ['existing'] }, [
          new Uint8Array([1]),
          new Uint8Array([2]),
        ]),
      ).resolves.toEqual({ messageId: 'sent' });
      expect(fetch).toHaveBeenCalledTimes(7);
    } finally {
      await itd.close();
    }
  });

  it('не записывает неиспользованную сессию, сохраняет изменения и удаляет запись', async () => {
    const { itd } = setup();
    const set = vi.fn();
    const remove = vi.fn();
    const initial = vi.fn(() => ({ count: 0 }));
    const middleware = session({ storage: { get: () => undefined, set, delete: remove }, initial });
    const ctx = new ChatContext(itd, { type: ChatUpdateType.Typing, chatId: 'c1' }) as ChatContext<
      typeof itd
    > &
      SessionFlavor<{ count: number }>;
    try {
      await middleware(ctx, async () => {});
      expect(initial).not.toHaveBeenCalled();
      expect(set).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();

      await middleware(ctx, async () => {
        if (ctx.session) ctx.session.count += 1;
      });
      expect(set).toHaveBeenCalledExactlyOnceWith('chat-bot:c1', { count: 1 });

      await middleware(ctx, async () => {
        ctx.session = undefined;
        expect(ctx.session).toBeUndefined();
      });
      expect(remove).toHaveBeenCalledExactlyOnceWith('chat-bot:c1');
    } finally {
      await itd.close();
    }
  });
});

function withGate() {
  let resolve!: () => void;
  const promise = new Promise<void>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}
