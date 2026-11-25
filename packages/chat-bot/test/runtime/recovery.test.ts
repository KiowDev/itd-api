import { ChatUpdateType, MemoryKeyValueStore } from 'itd-api';
import { describe, expect, it, vi } from 'vitest';
import { ChatBot, type ChatContext } from '../../src/index.js';
import { message, setup, withGate } from '../helpers/bot.fixtures.js';

describe('Восстановление событий ChatBot', () => {
  it('передаёт ошибку восстановления из start() и в событие жизненного цикла', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/chats')) return Response.json({ chats: [] });
      return Response.json({ events: [], reset_required: true, next_event_seq: 10 });
    });
    const { itd, nextSocket } = setup(fetch);
    const bot = new ChatBot(itd);
    const failed = vi.fn();
    const stopped = vi.fn();
    bot.on('error', failed).on('stop', stopped);
    try {
      const starting = bot.start(10);
      const error = expect.objectContaining({
        message: 'В списке чатов нет номера события для восстановления',
      });
      const rejected = expect(starting).rejects.toEqual(error);
      (await nextSocket()).open();
      await rejected;
      expect(failed).toHaveBeenCalledExactlyOnceWith(error);
      expect(stopped).toHaveBeenCalledOnce();
      expect(bot.isRunning).toBe(false);
      expect(bot.isReady).toBe(false);
    } finally {
      await itd.close();
    }
  });

  it('прекращает восстановление, если канал уже открыл другой подписчик', async () => {
    const listStarted = withGate();
    const listReady = withGate();
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      if (new URL(String(input)).pathname.endsWith('/chats')) {
        listStarted.resolve();
        await listReady.promise;
        return Response.json({ chats: [], event_seq: 20 });
      }
      return Response.json({ events: [], reset_required: true, next_event_seq: 10 });
    });
    const { itd, nextSocket } = setup(fetch);
    const storage = new MemoryKeyValueStore<number>();
    await storage.set('bot', 10);
    const bot = new ChatBot(itd, { checkpoint: { key: 'bot', storage } });
    const handled = vi.fn();
    const received = vi.fn();
    const failed = vi.fn();
    bot.use(handled).on('error', failed);
    bot.stream.on('update', received);
    try {
      const starting = bot.start();
      const rejected = expect(starting).rejects.toThrow('Канал чатов уже активен');
      (await nextSocket()).open();
      await listStarted.promise;

      const external = bot.stream.connect();
      const socket = await nextSocket(1);
      socket.open();
      await external;
      listReady.resolve();
      await rejected;
      await bot.drain();

      socket.update({ type: ChatUpdateType.NewMessage, chat_id: 'c1', event_seq: 25 });
      await vi.waitFor(() => expect(received).toHaveBeenCalledOnce());
      expect(socket.readyState).toBe(1);
      expect(failed).toHaveBeenCalledOnce();
      expect(handled).not.toHaveBeenCalled();
      expect(await storage.get('bot')).toBe(10);
    } finally {
      listReady.resolve();
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

  it.each([
    { options: undefined, limit: 256 },
    { options: { maxPendingUpdates: 300 }, limit: 300 },
  ])('догружает события при переполнении (лимит $limit)', async ({ options, limit }) => {
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

  it('при переполнении без номера события завершает принятую работу и сообщает об ошибке', async () => {
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
});
