import { ChatUpdateType, MemoryKeyValueStore } from 'itd-api';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { ChatBot, ChatBotLifecycleEvent } from '../../src/index.js';
import { message, setup, withGate } from '../helpers/bot.fixtures.js';

describe('Жизненный цикл ChatBot', () => {
  it('сообщает об открытии сокета, переподключении и остановке после последней попытки', async () => {
    const { itd, nextSocket } = setup(undefined, undefined, { backoff: [0], maxAttempts: 1 });
    const bot = new ChatBot(itd);
    const seen = vi.fn();
    const command = vi.fn();
    const connected = withGate();
    bot
      .on(ChatBotLifecycleEvent.Connect, async () => {
        seen('connect', bot.isRunning, bot.isReady);
        await connected.promise;
      })
      .on(ChatBotLifecycleEvent.Reconnect, (info) => {
        expectTypeOf(info).toEqualTypeOf<{ attempt: number; delay: number }>();
        seen('reconnect', info.attempt, info.delay, bot.isReady);
      })
      .on(ChatBotLifecycleEvent.Error, (error) => seen('error', error, bot.isRunning))
      .on(ChatBotLifecycleEvent.Stop, () => seen('stop', bot.isRunning, bot.isReady));
    bot.command('hello', command);
    try {
      expect(bot.isRunning).toBe(false);
      expect(bot.isReady).toBe(false);
      const started = bot.start();
      const first = await nextSocket();
      expect(bot.isRunning).toBe(true);
      expect(bot.isReady).toBe(false);
      expect(seen).not.toHaveBeenCalled();
      first.open();
      await started;
      expect(seen.mock.calls).toEqual([['connect', true, true]]);
      first.update({ type: ChatUpdateType.NewMessage, chat_id: 'c1', message: message('/hello') });
      await vi.waitFor(() => expect(command).toHaveBeenCalledOnce());

      first.close();
      const second = await nextSocket(1);
      expect(seen.mock.calls.at(-1)).toEqual(['reconnect', 1, 0, false]);
      expect(bot.isRunning).toBe(true);
      second.open();
      await vi.waitFor(() => expect(seen.mock.calls.at(-1)).toEqual(['connect', true, true]));
      second.close();
      (await nextSocket(2)).close();
      await vi.waitFor(() => expect(bot.isRunning).toBe(false));
      expect(seen.mock.calls.slice(2)).toEqual([
        ['connect', true, true],
        ['reconnect', 1, 0, false],
        ['error', expect.any(Error), false],
        ['stop', false, false],
      ]);
      expect(bot.isReady).toBe(false);
    } finally {
      connected.resolve();
      await itd.close();
    }
  });

  it.each([false, true])(
    'после обрыва заканчивает принятые события, пока сессия актуальна (смена сессии: %s)',
    async (switchSession) => {
      const { itd, nextSocket } = setup(undefined, undefined, { maxAttempts: 0 });
      const storage = new MemoryKeyValueStore<number>();
      const bot = new ChatBot(itd, { checkpoint: { key: 'bot', storage } });
      const gate = withGate();
      const accepted = vi.fn();
      const handled = vi.fn();
      const failed = vi.fn();
      const stopped = vi.fn();
      let signal: AbortSignal | undefined;
      bot.stream.on('update', accepted);
      bot.on(ChatBotLifecycleEvent.Error, failed).on(ChatBotLifecycleEvent.Stop, stopped);
      bot.use(async (ctx) => {
        if (ctx.update.eventSeq === 10) {
          signal = ctx.signal;
          await gate.promise;
        }
        handled(ctx.update.eventSeq, ctx.signal?.aborted);
      });
      try {
        const started = bot.start();
        const socket = await nextSocket();
        socket.open();
        await started;
        for (const event_seq of [10, 11]) {
          socket.update({ type: ChatUpdateType.NewMessage, chat_id: 'c1', event_seq });
        }
        await vi.waitFor(() => {
          expect(signal).toBeDefined();
          expect(accepted).toHaveBeenCalledTimes(2);
        });
        socket.close();
        await vi.waitFor(() => expect(failed).toHaveBeenCalledOnce());
        expect(signal?.aborted).toBe(false);
        expect(stopped).not.toHaveBeenCalled();
        await expect(bot.start()).rejects.toThrow('bot.drain()');

        if (switchSession) {
          const switching = itd.setSession({ accessToken: 'another-test-token' });
          await vi.waitFor(() => expect(signal?.aborted).toBe(true));
          gate.resolve();
          await switching;
        } else {
          gate.resolve();
        }
        await bot.drain();
        expect(stopped).toHaveBeenCalledOnce();
        expect(bot.isRunning).toBe(false);
        expect(handled.mock.calls).toEqual(
          switchSession
            ? [[10, true]]
            : [
                [10, false],
                [11, false],
              ],
        );
        expect(await storage.get('bot')).toBe(switchSession ? undefined : 11);
      } finally {
        gate.resolve();
        await itd.close();
      }
    },
  );

  it('отбрасывает очередь и отменяет ответы начатого обработчика при смене сессии', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const { itd, nextSocket } = setup(fetch);
    const bot = new ChatBot(itd);
    const queued = vi.fn();
    const entered = vi.fn();
    const received = vi.fn();
    const { promise, resolve } = withGate();
    const connected = vi.fn();
    const stopped = vi.fn();
    bot.on('connect', connected).on('stop', stopped);
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
      expect(bot.isRunning).toBe(false);
      expect(stopped).toHaveBeenCalledOnce();
      resolve();
      await bot.drain();
      expect(fetch).not.toHaveBeenCalled();
      expect(queued).not.toHaveBeenCalled();

      const reopened = bot.stream.connect();
      const next = await nextSocket(1);
      next.open();
      await reopened;
      expect(connected).toHaveBeenCalledOnce();
      await bot.start();
      expect(connected).toHaveBeenCalledTimes(2);
      next.update({ type: ChatUpdateType.NewMessage, chat_id: 'c1', message: message('/queued') });
      await vi.waitFor(() => expect(queued).toHaveBeenCalledOnce());
      bot.stop();
      bot.stop();
      await vi.waitFor(() => expect(stopped).toHaveBeenCalledTimes(2));
    } finally {
      resolve();
      bot.stop();
      await bot.drain();
      await itd.close();
    }
  });
});
