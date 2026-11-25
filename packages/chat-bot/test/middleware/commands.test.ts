import { ChatUpdateType } from 'itd-api';
import { describe, expect, it, vi } from 'vitest';
import { ChatBot, ChatBotFilter } from '../../src/index.js';
import { message, setup } from '../helpers/bot.fixtures.js';

describe('Команды и фильтры ChatBot', () => {
  it('распознаёт кириллицу, регистр и буквальные префиксы команд', async () => {
    const { itd, nextSocket } = setup();
    const bot = new ChatBot(itd, { commandPrefixes: ['!', '!!', '.'] });
    const received = vi.fn();
    bot.command(['помощь', 'подъём'], (ctx) => received(ctx.command, ctx.args));

    try {
      const starting = bot.start();
      const socket = await nextSocket();
      socket.open();
      await starting;
      socket.update({
        type: ChatUpdateType.NewMessages,
        chat_id: 'c1',
        messages: [
          message('/помощь', 'm1'),
          message('xпомощь', 'm2'),
          message('.ПоМОЩЬ\t  АрГ\nТеКст', 'm3'),
          message(`!!${'ПОДЪЁМ'.normalize('NFD')} ДоМоЙ`, 'm4'),
          message('!помощь', 'm5'),
        ],
      });
      await vi.waitFor(() =>
        expect(received.mock.calls).toEqual([
          ['помощь', 'АрГ\nТеКст'],
          ['подъём', 'ДоМоЙ'],
          ['помощь', ''],
        ]),
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
        message: message('/Echo привет'),
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
});
