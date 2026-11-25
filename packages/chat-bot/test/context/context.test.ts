import { message as buildMessage, ChatActionType, ChatUpdateType } from 'itd-api';
import { describe, expect, it, vi } from 'vitest';
import { hydrateClient } from '../../../hydrate/src/index.js';
import { ChatBot, ChatContext } from '../../src/index.js';
import { message, setup } from '../helpers/bot.fixtures.js';

describe('ChatContext', () => {
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

  it('отправляет действие в чат события и учитывает отмену', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 204 }));
    const { itd } = setup(fetch);
    const controller = new AbortController();
    const ctx = new ChatContext(
      itd,
      { type: ChatUpdateType.NewMessage, chatId: 'c1' },
      undefined,
      controller.signal,
    );

    try {
      await ctx.sendAction();
      await ctx.sendAction(ChatActionType.UploadPhoto, 0.5);
      expect(
        fetch.mock.calls.map(([url, request]) => [
          new URL(String(url)).pathname,
          JSON.parse(String(request?.body)),
        ]),
      ).toEqual([
        ['/api/v1/messenger/chats/c1/action', { type: ChatActionType.Typing }],
        ['/api/v1/messenger/chats/c1/action', { type: ChatActionType.UploadPhoto, progress: 0.5 }],
      ]);
      controller.abort();
      expect(() => ctx.sendAction()).toThrow(expect.objectContaining({ name: 'AbortError' }));
      expect(fetch).toHaveBeenCalledTimes(2);
    } finally {
      await itd.close();
    }
  });

  it('отправляет карточку и вложение из билдера сообщения', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ message_id: 'sent' }));
    const { itd } = setup(fetch);
    const ctx = new ChatContext(itd, { type: ChatUpdateType.NewMessage, chatId: 'c1' });
    try {
      await ctx.send(buildMessage().post('p1').attachId('f1'));
      expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
        text: '',
        reply_to_id: null,
        attachments: ['f1'],
        entities: [{ type: 'post', post_id: 'p1' }],
      });
    } finally {
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

  it('учитывает один deadline на загрузку файлов и отправку сообщения', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn<typeof globalThis.fetch>(async (url) => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith('/init')) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return Response.json({ uploadId: 'upload' });
      }
      if (path.endsWith('/part/0')) return new Response(null, { status: 204 });
      if (path.endsWith('/finalize')) return Response.json({ fileId: 'file' });
      throw new Error('Сообщение отправлено после истечения срока');
    });
    const { itd } = setup(fetch);
    const ctx = new ChatContext(itd, { type: ChatUpdateType.NewMessage, chatId: 'c1' });
    try {
      const first = new Uint8Array([1]);
      const second = new Uint8Array([2]);
      const result = ctx.sendWithAttachments({ text: '', files: [first] }, [second], {
        deadline: 30,
      });
      const failure = expect(result).rejects.toMatchObject({
        name: 'ItdTimeoutError',
        budget: 'deadline',
        timeout: 30,
      });
      await vi.advanceTimersByTimeAsync(30);
      await failure;
      expect(
        fetch.mock.calls.map(([url]) => new URL(String(url)).pathname.split('/').at(-1)),
      ).toEqual(['init', '0', 'finalize', 'init']);
      await vi.advanceTimersByTimeAsync(10);
      expect(fetch).toHaveBeenCalledTimes(4);
    } finally {
      await itd.close();
      vi.useRealTimers();
    }
  });
});
