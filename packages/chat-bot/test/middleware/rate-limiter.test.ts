import { ChatUpdateType, ItdConfigError, MemoryKeyValueStore } from 'itd-api';
import { describe, expect, it, vi } from 'vitest';
import { ChatBot, ChatComposer, ChatContext, RateLimiter } from '../../src/index.js';
import { message, setup, withGate } from '../helpers/bot.fixtures.js';

const incoming = { messageId: 'm1', senderId: 'u1', createdAt: '2026-11-20T00:00:00Z' };

describe('RateLimiter', () => {
  it('считает входящие по отправителю и открывает новое окно по истечении старого', async () => {
    const { itd } = setup();
    const now = vi.spyOn(performance, 'now').mockReturnValue(0);
    const next = vi.fn(async () => {});
    const onLimit = vi.fn();
    const run = new RateLimiter({ limit: 1, window: 100, onLimit }).middleware();
    const first = new ChatContext(itd, { type: ChatUpdateType.NewMessage, chatId: 'c1' }, incoming);
    const second = new ChatContext(
      itd,
      { type: ChatUpdateType.NewMessage, chatId: 'c2' },
      incoming,
    );
    const another = new ChatContext(itd, first.update, { ...incoming, senderId: 'u2' });
    try {
      for (const type of [
        ChatUpdateType.MessageEdited,
        ChatUpdateType.OwnMessages,
        ChatUpdateType.Typing,
        ChatUpdateType.MessageReactions,
      ]) {
        await run(new ChatContext(itd, { ...first.update, type }, incoming), next);
      }
      expect(next).toHaveBeenCalledTimes(4);
      await run(first, next);
      now.mockReturnValue(10);
      await run(another, next);
      await run(second, next);
      await run(first, next);
      expect(next).toHaveBeenCalledTimes(6);
      expect(onLimit).toHaveBeenCalledExactlyOnceWith(second);

      now.mockReturnValue(100);
      await run(first, next);
      await run(second, next);
      await run(another, next);
      expect(next).toHaveBeenCalledTimes(7);
      expect(onLimit.mock.calls).toEqual([[second], [second], [another]]);
    } finally {
      now.mockRestore();
      await itd.close();
    }
  });

  it('ограничивает реакции и удаления в ветках с явным ключом', async () => {
    const { itd } = setup();
    const composer = new ChatComposer();
    const handleChange = vi.fn();
    const handleOther = vi.fn();
    composer
      .on([ChatUpdateType.MessageReactions, ChatUpdateType.MessagesDeleted])
      .use(new RateLimiter({ limit: 1, window: 10_000, key: (ctx) => ctx.chatId }), handleChange);
    composer.on(ChatUpdateType.MessageEdited).use(handleOther);
    const run = composer.middleware();
    const next = async () => {};
    const reaction = new ChatContext(itd, { type: ChatUpdateType.MessageReactions, chatId: 'c1' });
    const deletion = new ChatContext(itd, { type: ChatUpdateType.MessagesDeleted, chatId: 'c1' });
    const noKey = new ChatContext(itd, { type: ChatUpdateType.MessagesDeleted });
    try {
      await run(reaction, next);
      await run(deletion, next);
      await run(noKey, next);
      await run(noKey, next);
      await run(new ChatContext(itd, { type: ChatUpdateType.MessageEdited, chatId: 'c1' }), next);
      expect(handleChange.mock.calls.map(([ctx]) => ctx)).toEqual([reaction, noKey, noKey]);
      expect(handleOther).toHaveBeenCalledOnce();
    } finally {
      await itd.close();
    }
  });

  it('вызывает onLimit один раз, пока предыдущий вызов ещё выполняется', async () => {
    const { itd } = setup();
    const { promise, resolve } = withGate();
    const onLimit = vi.fn(() => promise);
    const next = vi.fn(async () => {});
    const run = new RateLimiter({ limit: 1, window: 10_000, onLimit }).middleware();
    const context = (chatId: string) =>
      new ChatContext(itd, { type: ChatUpdateType.NewMessages, chatId }, incoming);
    try {
      const pending = [
        run(context('c1'), next),
        run(context('c2'), next),
        run(context('c3'), next),
      ];
      expect(next).toHaveBeenCalledOnce();
      expect(onLimit).toHaveBeenCalledOnce();
      resolve();
      await Promise.all(pending);
    } finally {
      resolve();
      await itd.close();
    }
  });

  it('при заполнении сохраняет действующие окна и освобождает просроченные', async () => {
    const { itd } = setup();
    const now = vi.spyOn(performance, 'now').mockReturnValue(0);
    const next = vi.fn(async () => {});
    const run = new RateLimiter({ limit: 1, window: 100, key: (ctx) => ctx.chatId }).middleware();
    const context = (chatId: string) =>
      new ChatContext(itd, { type: ChatUpdateType.Typing, chatId });
    try {
      for (let id = 0; id < 10_000; id++) await run(context(String(id)), next);
      next.mockClear();
      await run(context('extra'), next);
      await run(context('extra'), next);
      await run(context('0'), next);
      expect(next).toHaveBeenCalledTimes(2);
      now.mockReturnValue(100);
      await run(context('extra'), next);
      await run(context('extra'), next);
      expect(next).toHaveBeenCalledTimes(3);
    } finally {
      now.mockRestore();
      await itd.close();
    }
  });

  it('сохраняет номер пакетного события, даже когда часть сообщений превысила лимит', async () => {
    const { itd, nextSocket } = setup();
    const storage = new MemoryKeyValueStore<number>();
    const bot = new ChatBot(itd, { checkpoint: { key: 'bot', storage } });
    const handled = vi.fn();
    bot.use(new RateLimiter({ limit: 1, window: 10_000 }));
    bot.command('go').use(handled);
    try {
      const starting = bot.start();
      const socket = await nextSocket();
      socket.open();
      await starting;
      socket.update({
        type: ChatUpdateType.NewMessages,
        chat_id: 'c1',
        event_seq: 1,
        messages: [message('/go'), message('/go', 'm2')],
      });
      await vi.waitFor(async () => expect(await storage.get('bot')).toBe(1));
      expect(handled).toHaveBeenCalledOnce();
    } finally {
      await itd.close();
    }
  });

  it('отклоняет неположительный лимит и дробное окно', () => {
    expect(() => new RateLimiter({ limit: 0, window: 100 })).toThrow(ItdConfigError);
    expect(() => new RateLimiter({ limit: 1, window: 0.5 })).toThrow(ItdConfigError);
  });
});
