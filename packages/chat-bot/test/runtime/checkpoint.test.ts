import { ChatUpdateType, MemoryKeyValueStore } from 'itd-api';
import { describe, expect, it, vi } from 'vitest';
import { ChatBot, ChatBotFilter } from '../../src/index.js';
import { message, setup, withGate } from '../helpers/bot.fixtures.js';

describe('Сохранение номера события ChatBot', () => {
  it('оставляет перехваченное событие для повтора и передаёт внешнюю ошибку в bot.catch()', async () => {
    const { itd, nextSocket } = setup();
    const storage = new MemoryKeyValueStore<number>();
    const bot = new ChatBot(itd, { checkpoint: { key: 'bot', storage } });
    const inner = new Error('Ошибка команды');
    const outer = new Error('Ошибка внешнего обработчика');
    const local = vi.fn();
    const global = vi.fn();
    const tail = vi.fn();
    bot
      .on(ChatBotFilter.MessageText)
      .errorBoundary(({ error, context }, next) => {
        local(error, context.update.eventSeq);
        return next();
      })
      .command('fail', () => {
        throw inner;
      });
    bot.use((ctx) => {
      tail(ctx.update.eventSeq);
      if (ctx.update.eventSeq === 3) throw outer;
    });
    bot.catch((error, ctx) => global(error, ctx.update.eventSeq));
    try {
      const starting = bot.start();
      const socket = await nextSocket();
      socket.open();
      await starting;
      for (const [seq, text] of [
        [1, 'привет'],
        [2, '/fail'],
        [3, 'дальше'],
      ] as const) {
        socket.update({
          type: ChatUpdateType.NewMessage,
          chat_id: 'c1',
          event_seq: seq,
          message: message(text, String(seq)),
        });
      }
      await vi.waitFor(() => expect(tail.mock.calls).toEqual([[1], [2], [3]]));
      await bot.drain();
      expect(local.mock.calls).toEqual([[inner, 2]]);
      expect(global.mock.calls).toEqual([[outer, 3]]);
      expect(await storage.get('bot')).toBe(1);
    } finally {
      await itd.close();
    }
  });

  it.each(['checkpoint', 'stop'] as const)(
    'сохраняет открытый канал и не принимает события во время чтения checkpoint (%s)',
    async (mode) => {
      const { itd, nextSocket } = setup();
      const gate = withGate();
      const storage = {
        get: vi.fn(async () => {
          await gate.promise;
          return 10;
        }),
        set: vi.fn(),
        delete: vi.fn(),
      };
      const events = itd.chats.events;
      const external = vi.fn();
      events.on('update', external);
      const bot = new ChatBot(itd, { checkpoint: { storage, key: 'bot' } });
      const handled = vi.fn();
      bot.use(handled);
      try {
        const opened = events.connect();
        const socket = await nextSocket();
        socket.open();
        await opened;

        const started = bot.start();
        const failed = expect(started).rejects.toMatchObject({
          name: mode === 'stop' ? 'ItdAbortError' : 'ItdStateError',
        });
        expect(bot.start()).toBe(started);
        await vi.waitFor(() => expect(storage.get).toHaveBeenCalledOnce());
        socket.update({ type: ChatUpdateType.NewMessage, chat_id: 'c1', event_seq: 21 });
        await vi.waitFor(() => expect(external).toHaveBeenCalledOnce());

        if (mode === 'stop') bot.stop();
        gate.resolve();
        await failed;
        expect(events.active).toBe(true);
        expect(handled).not.toHaveBeenCalled();
        expect(storage.set).not.toHaveBeenCalled();

        await expect(bot.start(0)).rejects.toThrow('Канал чатов уже активен');
        expect(events.active).toBe(true);

        const liveBot = new ChatBot(itd);
        const ready = vi.fn();
        liveBot.on('connect', ready);
        liveBot.use(handled);
        await liveBot.start();
        expect(liveBot.isReady).toBe(true);
        expect(ready).toHaveBeenCalledOnce();
        await expect(liveBot.start(0)).rejects.toMatchObject({ name: 'ItdStateError' });
        socket.update({ type: ChatUpdateType.NewMessage, chat_id: 'c1', event_seq: 22 });
        await vi.waitFor(() => expect(handled).toHaveBeenCalledOnce());
      } finally {
        gate.resolve();
        await itd.close();
      }
    },
  );

  it('сохраняет позицию после завершения обработчиков и читает её при новом запуске', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      const since = new URL(String(input)).searchParams.get('since');
      return Response.json({ events: [], next_event_seq: Number(since) });
    });
    const { itd, nextSocket } = setup(fetch);
    const storage = new MemoryKeyValueStore<number>();
    const checkpoint = { storage, key: 'bot' };
    const bot = new ChatBot(itd, { checkpoint, concurrency: 2 });
    const gate = withGate();
    const completed = vi.fn();
    bot.use(async ({ update }) => {
      if (update.eventSeq === 11) await gate.promise;
      completed(update.eventSeq);
    });

    try {
      const starting = bot.start();
      const socket = await nextSocket();
      socket.open();
      await starting;
      socket.update({ type: ChatUpdateType.NewMessage, chat_id: 'c1', event_seq: 11 });
      socket.update({ type: ChatUpdateType.NewMessage, chat_id: 'c2', event_seq: 12 });
      await vi.waitFor(() => expect(completed.mock.calls).toEqual([[12]]));
      expect(storage.get('bot')).toBeUndefined();

      gate.resolve();
      await vi.waitFor(() => expect(storage.get('bot')).toBe(12));
      bot.stop();
      await bot.drain();

      const restarted = new ChatBot(itd, { checkpoint });
      const restarting = restarted.start();
      (await nextSocket(1)).open();
      await restarting;
      expect(new URL(String(fetch.mock.calls[0]?.[0])).searchParams.get('since')).toBe('12');
    } finally {
      gate.resolve();
      await itd.close();
    }
  });

  it('не сохраняет позицию после события, обработчик которого завершился ошибкой', async () => {
    const { itd, nextSocket } = setup();
    const storage = new MemoryKeyValueStore<number>();
    const bot = new ChatBot(itd, { checkpoint: { storage, key: 'bot' } });
    const handled = vi.fn();
    bot.catch(() => {});
    bot.use(({ update }) => {
      if (update.eventSeq === 2) throw new Error('Ошибка обработки');
      handled(update.eventSeq);
    });

    try {
      const starting = bot.start();
      const socket = await nextSocket();
      socket.open();
      await starting;
      for (const eventSeq of [1, 2, 3]) {
        socket.update({ type: ChatUpdateType.NewMessage, chat_id: 'c1', event_seq: eventSeq });
      }
      await vi.waitFor(() => expect(handled.mock.calls).toEqual([[1], [3]]));
      await bot.drain();
      expect(storage.get('bot')).toBe(1);
    } finally {
      await itd.close();
    }
  });

  it('сохраняет позицию после всего пакета и ждёт запись при остановке', async () => {
    const { itd, nextSocket } = setup();
    const handling = withGate();
    const saving = withGate();
    const handled = vi.fn();
    const set = vi.fn(() => saving.promise);
    const storage = { get: () => undefined, set, delete: () => {} };
    const bot = new ChatBot(itd, { checkpoint: { storage, key: 'bot' } });
    bot.use(async (ctx) => {
      handled(ctx.message?.messageId);
      if (ctx.message?.messageId === 'm2') await handling.promise;
    });

    try {
      const starting = bot.start();
      const socket = await nextSocket();
      socket.open();
      await starting;
      socket.update({
        type: ChatUpdateType.NewMessages,
        chat_id: 'c1',
        event_seq: 12,
        messages: [message('первое'), message('второе', 'm2')],
      });
      await vi.waitFor(() => expect(handled.mock.calls).toEqual([['m1'], ['m2']]));
      expect(set).not.toHaveBeenCalled();
      handling.resolve();
      await vi.waitFor(() => expect(set).toHaveBeenCalledExactlyOnceWith('bot', 12));

      bot.stop();
      const drained = vi.fn();
      const stopping = bot.drain().then(drained);
      await Promise.resolve();
      expect(drained).not.toHaveBeenCalled();
      saving.resolve();
      await stopping;
      expect(drained).toHaveBeenCalledOnce();
    } finally {
      handling.resolve();
      saving.resolve();
      await itd.close();
    }
  });
});
