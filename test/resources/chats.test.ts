import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { ChatActionType, ChatMediaCategory, ChatReactionType, ItdClient } from '../../src/index.js';
import { createRestClient, fromStream } from '../../src/rest.js';
import { createMockFetch, json, noContent } from '../helpers/mock-fetch.js';

const clientOptions = {
  baseUrl: 'https://itd.test',
  auth: 'test-token',
  retry: false,
  rateLimit: false,
} as const;
const chat = { chat_id: 'first', chat_type: 0, unread_count: 2 };
const message = { message_id: 'm1', sender_id: 'u1', created_at: '2026-11-20 00:00:00' };
const sdkChat = { chatId: 'first', chatType: 0, unreadCount: 2 };
const sdkMessage = { messageId: 'm1', senderId: 'u1', createdAt: '2026-11-20T00:00:00Z' };
const fromMessenger = (suffix: string) => `https://itd.test/api/v1/messenger${suffix}`;

describe('chats', () => {
  it.each([
    ['full', (fetch: typeof globalThis.fetch) => new ItdClient({ ...clientOptions, fetch })],
    ['rest', (fetch: typeof globalThis.fetch) => createRestClient({ ...clientOptions, fetch })],
  ] as const)('%s uses the current messenger paths and bearer authorization', async (_, create) => {
    const history = {
      messages: [
        {
          ...message,
          edited_at: null,
          entities: [{ type: 'post', post_id: 'p1' }],
          reply_to: { message_id: 'm1', sender_id: 'u1', text: 'hello' },
        },
      ],
      read_cursors: { user_id: { message_id: 'm1', timestamp: '2026-11-20 00:02:00' } },
      has_older: false,
      event_seq: 6,
    };
    const sdkHistory = {
      messages: [
        {
          ...sdkMessage,
          editedAt: null,
          entities: [{ type: 'post', postId: 'p1' }],
          replyTo: { messageId: 'm1', senderId: 'u1', text: 'hello' },
        },
      ],
      readCursors: { user_id: { messageId: 'm1', timestamp: '2026-11-20T00:02:00Z' } },
      hasOlder: false,
      eventSeq: 6,
    };
    const unread = { total: 2, chats_with_unread: 1, event_seq: 6 };
    const updates = {
      events: [
        { type: 'typing', chat_id: 'first', user_id: 'u1', action: 'upload_video', progress: 0 },
      ],
      next_event_seq: 6,
      reset_required: false,
    };
    const mock = createMockFetch([
      json({ chats: [chat], next_before: 'next', event_seq: 6 }),
      json(chat),
      json(unread),
      json(history),
      json({ messages: [message], has_newer: false }),
      json({ items: [] }),
      json({ presence: { u1: true, u2: false } }),
      json(updates),
    ]);
    const client = create(mock.fetch);
    try {
      expect(await client.chats.list({ limit: 10 })).toEqual({
        chats: [sdkChat],
        nextBefore: 'next',
        eventSeq: 6,
      });
      expect(await client.chats.get('first')).toEqual(sdkChat);
      expect(await client.chats.unread()).toEqual({ total: 2, chatsWithUnread: 1, eventSeq: 6 });
      expect(await client.chats.messages('first', { before: 'm0' })).toEqual(sdkHistory);
      expect(await client.chats.messagesAround('first', 'm/1')).toEqual({
        messages: [sdkMessage],
        hasNewer: false,
      });
      await client.chats.media('first', ChatMediaCategory.Media);
      expect(await client.chats.presenceMany(['u1', 'u2'])).toEqual({ u1: true, u2: false });
      const page = await client.chats.updates(3);
      expectTypeOf(page.events[0]?.progress).toEqualTypeOf<number | undefined>();
      expect(page).toEqual({
        events: [
          {
            type: 'typing',
            chatId: 'first',
            userId: 'u1',
            action: ChatActionType.UploadVideo,
            progress: 0,
          },
        ],
        nextEventSeq: 6,
        resetRequired: false,
      });

      expect(mock.calls.map(({ url }) => url)).toEqual([
        fromMessenger('/chats?limit=10&manual_unread=1'),
        fromMessenger('/chats/first?manual_unread=1'),
        fromMessenger('/chats/unread?manual_unread=1'),
        fromMessenger('/chats/first/messages?before=m0'),
        fromMessenger('/chats/first/messages/around/m%2F1?limit=40'),
        fromMessenger('/chats/first/media?category=0'),
        fromMessenger('/presence'),
        fromMessenger('/updates?since=3&capabilities=chat_settings&manual_unread=1'),
      ]);
      expect(
        mock.calls.every(({ headers }) => headers.get('authorization') === 'Bearer test-token'),
      ).toBe(true);
      expect(mock.calls.find(({ url }) => url === fromMessenger('/presence'))).toMatchObject({
        method: 'POST',
        body: '{"user_ids":["u1","u2"]}',
      });
    } finally {
      await client.close();
    }
  });

  it('continues list iteration with the opaque cursor', async () => {
    const second = { ...chat, chat_id: 'second' };
    const mock = createMockFetch([
      json({ chats: [chat], next_before: 'next' }),
      json({ chats: [second], next_before: null }),
    ]);
    const client = createRestClient({ ...clientOptions, fetch: mock.fetch });
    try {
      expect(await client.chats.iterate({ limit: 1, before: 'start' }).collect()).toEqual([
        sdkChat,
        { ...sdkChat, chatId: 'second' },
      ]);
      expect(mock.calls.map(({ url }) => new URL(url).searchParams.get('before'))).toEqual([
        'start',
        'next',
      ]);
    } finally {
      await client.close();
    }
  });

  it('continues full history pages without has_older using the oldest message ID', async () => {
    const older = { ...message, message_id: 'm0' };
    const mock = createMockFetch([
      json({ messages: [message] }),
      json({ messages: [older], has_older: false }),
    ]);
    const client = createRestClient({ ...clientOptions, fetch: mock.fetch });
    try {
      expect(await client.chats.iterateMessages('first', { limit: 1 }).collect()).toEqual([
        sdkMessage,
        { ...sdkMessage, messageId: 'm0' },
      ]);
      expect(mock.calls.map(({ url }) => new URL(url).searchParams.get('before'))).toEqual([
        null,
        'm1',
      ]);
    } finally {
      await client.close();
    }
  });

  it('keeps distinct routes and request bodies for writing messages and clearing history', async () => {
    const mock = createMockFetch([
      json({ message_id: 'm1' }),
      json({ chat_id: 'first', message_id: 'm2' }),
      json({ message_id: 'm1', event_seq: 3, edited_at: '2026-11-20 02:00:00+02' }),
      json({ ok: [{ source_message_id: 'm2' }], failed: [] }),
      json({ ok: ['m1'] }),
      json({ ok: ['m2'] }),
      json({ event_seq: 8 }),
      json({ event_seq: 9 }),
      json({ event_seq: 10 }),
      noContent(),
      json({ reactions: [], reaction_version: '8' }),
    ]);
    const client = createRestClient({ ...clientOptions, fetch: mock.fetch });
    const chats = client.chats;
    try {
      expect(await chats.sendMessage('first', { text: 'hello' })).toEqual({ messageId: 'm1' });
      await chats.sendMessageToUser('u1', {
        text: 'hello',
        attachmentIds: ['file'],
        clientMessageId: 'local',
      });
      expect(
        await chats.editMessage('first', 'm1', {
          text: 'edit',
          entities: [{ type: 'post', postId: 'p1' }],
        }),
      ).toEqual({ messageId: 'm1', eventSeq: 3, editedAt: '2026-11-20T00:00:00.000Z' });
      expect(
        await chats.forwardMessages('second', {
          sourceChatId: 'first',
          messageIds: ['m2'],
          clientMessageIds: { m2: 'forward-id' },
        }),
      ).toEqual({ ok: [{ sourceMessageId: 'm2' }], failed: [] });
      await chats.deleteMessagesForMe('first', ['m1']);
      await chats.deleteMessagesForAll('first', ['m2']);
      await chats.clearHistory('first');
      await chats.clearHistory('first', true);
      await chats.delete('first');
      await chats.sendAction('first', ChatActionType.UploadPhoto, 0.5);
      await chats.setReactions('first', 'm1', {
        reactions: [{ type: ChatReactionType.Custom, fileId: 'file' }],
        expectedVersion: '7',
        operationId: 'op',
      });

      expect(
        mock.calls.map(({ method, url, body }) => [
          method,
          url.replace(fromMessenger(''), ''),
          body === undefined ? undefined : JSON.parse(body),
        ]),
      ).toEqual([
        ['POST', '/chats/first/messages', { text: 'hello', reply_to_id: null }],
        [
          'POST',
          '/users/u1/messages',
          { text: 'hello', attachments: ['file'], client_message_id: 'local' },
        ],
        [
          'PATCH',
          '/chats/first/messages/m1',
          { text: 'edit', entities: [{ type: 'post', post_id: 'p1' }] },
        ],
        [
          'POST',
          '/chats/second/messages/forward',
          {
            source_chat_id: 'first',
            message_ids: ['m2'],
            client_message_ids: { m2: 'forward-id' },
          },
        ],
        ['POST', '/chats/first/messages/delete-for-me', { message_ids: ['m1'] }],
        ['POST', '/chats/first/messages/delete-for-all', { message_ids: ['m2'] }],
        ['POST', '/chats/first/clear-history', undefined],
        ['POST', '/chats/first/clear-history-all', undefined],
        ['POST', '/chats/first/delete', { for_everyone: false }],
        ['POST', '/chats/first/action', { type: 'upload_photo', progress: 0.5 }],
        [
          'PUT',
          '/chats/first/messages/m1/reactions',
          {
            reactions: [{ type: 'custom', file_id: 'file' }],
            expected_version: '7',
            operation_id: 'op',
          },
        ],
      ]);
    } finally {
      await client.close();
    }
  });

  it('does not replay a send with a client message ID after an ambiguous failure', async () => {
    const mock = createMockFetch(() => json({ error: 'unavailable' }, { status: 503 }));
    const client = createRestClient({
      ...clientOptions,
      fetch: mock.fetch,
      retry: { attempts: 2 },
    });
    try {
      await expect(
        client.chats.sendMessage('first', { text: 'hello', clientMessageId: 'local' }),
      ).rejects.toMatchObject({ status: 503 });
      expect(mock.callCount).toBe(1);
    } finally {
      await client.close();
    }
  });

  it('cancels an upload before finalization when closing the client', async () => {
    const mock = createMockFetch([json({ uploadId: 'upload' }), noContent()]);
    const client = createRestClient({ ...clientOptions, fetch: mock.fetch });
    let closing: Promise<void> | undefined;
    try {
      await expect(
        client.chats.uploadFile(new Uint8Array([1]), {
          onProgress: () => {
            closing = client.close();
          },
        }),
      ).rejects.toMatchObject({ name: 'ItdAbortError' });
      expect(mock.callCount).toBe(2);
    } finally {
      await (closing ?? client.close());
    }
  });

  it.each(['client', 'request'] as const)(
    'uses the %s deadline across upload requests and reading the stream',
    async (deadlineSource) => {
      vi.useFakeTimers();
      const close = vi.fn();
      const mock = createMockFetch(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return json({ uploadId: 'upload' });
      });
      const client = createRestClient({ ...clientOptions, fetch: mock.fetch, deadline: 30 });
      try {
        const file = fromStream(() => ({ stream: new ReadableStream(), size: 1, close }));
        const request = deadlineSource === 'request' ? { deadline: 40 } : {};
        const timeout = request.deadline ?? 30;
        const upload = client.chats.uploadFile(file, {}, request);
        const failure = expect(upload).rejects.toMatchObject({
          name: 'ItdTimeoutError',
          budget: 'deadline',
          timeout,
        });
        await vi.advanceTimersByTimeAsync(timeout - 1);
        expect(mock.callCount).toBe(1);
        expect(close).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        await failure;
        expect(close).toHaveBeenCalledOnce();
        expect(mock.callCount).toBe(1);
      } finally {
        await client.close();
        vi.useRealTimers();
      }
    },
  );

  it('uses raw binary parts for a stream and only finalizes after all bytes are sent', async () => {
    const mock = createMockFetch([
      json({ uploadId: 'upload' }),
      noContent(),
      noContent(),
      json({ fileId: 'file', sizeCipher: 5_242_889 }),
      json({ links: [{ fileId: 'file', url: '/v1/chat-files/file', expiresIn: 900 }] }),
    ]);
    const parts: Uint8Array[] = [];
    const client = createRestClient({
      ...clientOptions,
      fetch: (url, init) => {
        if (init?.body instanceof Uint8Array) parts.push(init.body);
        return mock.fetch(url, init);
      },
    });
    const close = vi.fn();
    const onProgress = vi.fn();
    const partBytes = 5 * 1024 * 1024;
    const file = fromStream(
      () => ({
        stream: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(partBytes - 1).fill(97));
            controller.enqueue(new Uint8Array([98, 99]));
            controller.close();
          },
        }),
        close,
      }),
      { filename: 'test.txt', contentType: 'text/plain', size: partBytes + 1 },
    );
    try {
      const thumb = { bytes: 'dGVzdA==', width: 20, height: 10 };
      expect(await client.chats.uploadFile(file, { thumb, onProgress })).toMatchObject({
        fileId: 'file',
      });
      expect(await client.chats.fileLinks('first', ['file'])).toEqual([
        { fileId: 'file', url: '/v1/chat-files/file', expiresIn: 900 },
      ]);
      expect(mock.calls.map(({ method, url }) => [method, url])).toEqual([
        ['POST', fromMessenger('/media/upload/init')],
        ['PUT', fromMessenger('/media/upload/upload/part/0')],
        ['PUT', fromMessenger('/media/upload/upload/part/1')],
        ['POST', fromMessenger('/media/upload/upload/finalize')],
        ['POST', fromMessenger('/chats/first/file-links')],
      ]);
      expect(JSON.parse(mock.calls[0]?.body ?? '{}')).toEqual({
        mime: 'text/plain',
        size: partBytes + 1,
        totalParts: 2,
      });
      expect(mock.calls[1]?.headers.get('content-type')).toBe('application/octet-stream');
      expect(parts.map(({ byteLength }) => byteLength)).toEqual([partBytes, 1]);
      expect(parts[0]?.at(-1)).toBe(98);
      expect(parts[1]?.[0]).toBe(99);
      expect(JSON.parse(mock.calls[3]?.body ?? '{}')).toEqual({ filename: 'test.txt', thumb });
      expect(onProgress.mock.calls).toEqual([
        [partBytes, partBytes + 1],
        [partBytes + 1, partBytes + 1],
      ]);
      expect(close).toHaveBeenCalledOnce();
    } finally {
      await client.close();
    }
  });
});
