import { ChatUpdateType } from 'itd-api';
import { describe, expect, it, vi } from 'vitest';
import { hydrateClient } from '../../../hydrate/src/index.js';
import { ChatBot, ChatBotError, ChatBotFilter } from '../../src/index.js';
import { message, setup, withGate } from '../helpers/bot.fixtures.js';

describe('Обработка обновлений ChatBot', () => {
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

  it.each([
    ['self', 0],
    [undefined, 1],
  ] as const)(
    'отличает сообщения собеседника в chat_created при ID из токена %s',
    async (tokenUserId, profileRequests) => {
      const fetch = vi.fn<typeof globalThis.fetch>(async (url) => {
        expect(new URL(String(url)).pathname).toBe('/api/users/me');
        return Response.json({ id: 'self' });
      });
      const { itd, nextSocket } = setup(fetch);
      const getUserId = vi.spyOn(itd, 'getUserId').mockResolvedValue(tokenUserId);
      const bot = new ChatBot(itd);
      const command = vi.fn();
      const heard = vi.fn();
      const incoming = vi.fn();
      bot.command('помощь', (ctx) => command(ctx.args));
      bot.hears('статус', (ctx) => heard(ctx.text));
      bot.on(ChatBotFilter.Message, (ctx) => incoming(ctx.message.messageId));

      try {
        const started = bot.start();
        const socket = await nextSocket();
        socket.open();
        await started;
        socket.update({
          type: ChatUpdateType.ChatCreated,
          chat_id: 'c1',
          messages: [
            { ...message('/помощь своё', 'm1'), sender_id: 'self' },
            message('/Помощь входящее', 'm2'),
            message('статус', 'm3'),
          ],
        });
        socket.update({
          type: ChatUpdateType.ChatCreated,
          chat_id: 'c2',
          messages: [message('текст', 'm4')],
        });
        await vi.waitFor(() => {
          expect(command.mock.calls).toEqual([['входящее']]);
          expect(heard.mock.calls).toEqual([['статус']]);
          expect(incoming.mock.calls).toEqual([['m4']]);
        });
        expect(getUserId).toHaveBeenCalledOnce();
        expect(fetch).toHaveBeenCalledTimes(profileRequests);
      } finally {
        bot.stop();
        await bot.drain();
        await itd.close();
      }
    },
  );

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
});
