import { ChatUpdateType, MemoryKeyValueStore } from 'itd-api';
import { describe, expect, it, vi } from 'vitest';
import { ChatBot, ChatContext, type SessionFlavor, session } from '../../src/index.js';
import { message, setup } from '../helpers/bot.fixtures.js';

describe('Сессии ChatBot', () => {
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
