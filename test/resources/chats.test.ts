import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import {
  ChatActionType,
  ChatMediaCategory,
  ChatReactionType,
  ItdAccounts,
  ItdClient,
  RateLimitErrorScope,
} from '../../src/index.js';
import {
  message as buildMessage,
  createRestClient,
  fromStream,
  RateLimitPacing,
} from '../../src/rest.js';
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
      json({ messages: [message], has_newer: false, target_message_id: 'm1' }),
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
        targetMessageId: 'm1',
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
      json({
        ok: [
          {
            source_message_id: 'm2',
            message_id: 'm3',
            created_at: '2026-11-20 02:00:00+02',
            forwarded_from_sender_id: 'u1',
            forwarded_from_name: null,
          },
        ],
        failed: [],
      }),
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
      ).toEqual({
        ok: [
          {
            sourceMessageId: 'm2',
            messageId: 'm3',
            createdAt: '2026-11-20T00:00:00.000Z',
            forwardedFromSenderId: 'u1',
            forwardedFromName: null,
          },
        ],
        failed: [],
      });
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

  it('shares a feed post as a message entity without text', async () => {
    const mock = createMockFetch([json({ message_id: 'm1' })]);
    const itd = createRestClient({ ...clientOptions, fetch: mock.fetch });
    try {
      await itd.chats.sendMessage('first', {
        text: '',
        entities: [{ type: 'post', postId: 'p1' }],
      });
      expect(JSON.parse(mock.calls[0]?.body ?? '{}')).toEqual({
        text: '',
        reply_to_id: null,
        entities: [{ type: 'post', post_id: 'p1' }],
      });
    } finally {
      await itd.close();
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

  it('charges a large forward to the destination chat without accumulating tokens while idle', async () => {
    const mock = createMockFetch(({ url }) =>
      url.endsWith('/forward')
        ? json({ ok: [], failed: [] })
        : json({ chat_id: 'target', message_id: 'm1' }),
    );
    vi.useFakeTimers();
    try {
      await using itd = createRestClient({
        ...clientOptions,
        fetch: mock.fetch,
        rateLimit: { pacing: RateLimitPacing.Smooth },
      });
      itd.use({
        name: 'rebuild-request',
        install({ operations }) {
          operations.use(({ operationId, method, path, body }, next) =>
            next({ operationId, method, path, body }),
          );
        },
      });

      await itd.chats.sendMessage('target', { text: 'before idle' });
      await vi.advanceTimersByTimeAsync(60_000);
      await itd.chats.forwardMessages('target', {
        sourceChatId: 'source',
        messageIds: Array.from({ length: 60 }, (_, i) => `m${i}`),
      });
      const next = itd.chats.sendMessage('target', { text: 'later' });
      await itd.chats.sendMessage('source', { text: 'now' });
      await itd.chats.sendMessageToUser('target', { text: 'now' });

      await vi.advanceTimersByTimeAsync(119_999);
      expect(mock.calls.map(({ url }) => url)).toEqual([
        fromMessenger('/chats/target/messages'),
        fromMessenger('/chats/target/messages/forward'),
        fromMessenger('/chats/source/messages'),
        fromMessenger('/users/target/messages'),
      ]);
      await vi.advanceTimersByTimeAsync(1);
      await expect(next).resolves.toMatchObject({ messageId: 'm1' });
      expect(mock.calls.at(-1)?.url).toBe(fromMessenger('/chats/target/messages'));
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    [false, []],
    [{ buckets: false }, ['default']],
  ] as const)('handles chat requests with rateLimit set to %j', async (rateLimit, buckets) => {
    const mock = createMockFetch(() => json({ message_id: 'm1' }));
    await using itd = createRestClient({ ...clientOptions, fetch: mock.fetch, rateLimit });

    await itd.chats.sendMessage('first', { text: 'one' });
    await itd.chats.sendMessage('second', { text: 'two' });

    expect(mock.callCount).toBe(2);
    expect(itd.rateLimitState().map(({ bucket }) => bucket)).toEqual(buckets);
    expect(itd.rateLimitState().every((state) => state.instance === undefined)).toBe(true);
  });

  it.each([
    {
      operation: 'send',
      headers: {
        'Retry-After': '1',
        'X-RateLimit-Retry-After-Ms': '723',
        'X-RateLimit-Limit': '30',
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Scope': RateLimitErrorScope.Chat,
      },
      delay: 723,
      retryDelays: [],
    },
    {
      operation: 'send',
      headers: { 'Retry-After': '112', 'X-RateLimit-Scope': RateLimitErrorScope.Chat },
      delay: 112_000,
      retryDelays: [90_000],
    },
    {
      operation: 'reaction',
      headers: { 'Retry-After': '1', 'X-RateLimit-Scope': RateLimitErrorScope.Chat },
      delay: 1000,
      retryDelays: [],
    },
    {
      operation: 'edit',
      headers: { 'Retry-After': '6' },
      delay: 6000,
      retryDelays: [],
    },
    {
      operation: 'delete',
      headers: { 'Retry-After': '3' },
      delay: 3000,
      retryDelays: [],
    },
  ])(
    'holds queued $operation requests for the server delay $delay',
    async ({ operation, headers, delay, retryDelays }) => {
      vi.useFakeTimers();
      try {
        const mock = createMockFetch((_request, index) =>
          index === 0 ? json({}, { status: 429, headers }) : json({ message_id: 'm', ok: ['m'] }),
        );
        await using itd = createRestClient({
          ...clientOptions,
          fetch: mock.fetch,
          rateLimit: { concurrency: 1, retryDelays },
        });
        const run = (id: string) => {
          if (operation === 'reaction')
            return itd.chats.setReactions(id, 'm', {
              reactions: [],
              expectedVersion: '1',
              operationId: 'op',
            });
          if (operation === 'edit') return itd.chats.editMessage(id, 'm', { text: 'test' });
          if (operation === 'delete') return itd.chats.deleteMessagesForMe(id, ['m', 'n', 'o']);
          return itd.chats.sendMessage(id, { text: 'test' });
        };

        const rejected = expect(run('target')).rejects.toMatchObject({
          status: 429,
          retryAfter: delay,
        });
        const pending = run('target');
        await run('other');
        await rejected;
        await vi.advanceTimersByTimeAsync(delay - 1);
        expect(mock.callCount).toBe(2);
        await vi.advanceTimersByTimeAsync(1);
        await pending;
        expect(mock.calls.at(-1)?.url).toContain('/chats/target/');
        const following = run('target');
        const interval = operation === 'send' ? 2000 : delay;
        await vi.advanceTimersByTimeAsync(interval - 1);
        expect(mock.callCount).toBe(3);
        await vi.advanceTimersByTimeAsync(1);
        await following;
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it('paces only the exhausted chat after its initial burst and retry', async () => {
    vi.useFakeTimers();
    try {
      const mock = createMockFetch((_request, index) =>
        index === 2
          ? json(
              {},
              {
                status: 429,
                headers: {
                  'X-RateLimit-Scope': RateLimitErrorScope.Chat,
                  'X-RateLimit-Retry-After-Ms': '663',
                  'X-RateLimit-Remaining': '0',
                },
              },
            )
          : json({ message_id: 'm' }),
      );
      await using client = createRestClient({ ...clientOptions, fetch: mock.fetch, rateLimit: {} });
      const send = (chat = 'a') => client.chats.sendMessage(chat, { text: 'test' });
      await send();
      await send();
      const retry = send();
      await vi.advanceTimersByTimeAsync(662);
      expect(mock.callCount).toBe(3);
      await vi.advanceTimersByTimeAsync(1);
      await retry;

      await vi.advanceTimersByTimeAsync(10);
      const next = send();
      await send('b');
      await client.chats.editMessage('a', 'm', { text: 'edited' });
      await vi.advanceTimersByTimeAsync(1989);
      expect(mock.callCount).toBe(6);
      await vi.advanceTimersByTimeAsync(1);
      await next;
      expect(mock.callCount).toBe(7);
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses the refill interval when a local rejection has no delay and retries are disabled', async () => {
    vi.useFakeTimers();
    try {
      const mock = createMockFetch((_request, index) =>
        index === 0
          ? json(
              {},
              {
                status: 429,
                headers: {
                  'X-RateLimit-Scope': RateLimitErrorScope.Chat,
                  'X-RateLimit-Limit': '60',
                },
              },
            )
          : json({ message_id: 'm' }),
      );
      await using client = createRestClient({
        ...clientOptions,
        fetch: mock.fetch,
        rateLimit: { retryDelays: [] },
      });
      const send = () => client.chats.sendMessage('a', { text: 'test' });
      await expect(send()).rejects.toMatchObject({ status: 429 });
      const two = Promise.all([send(), send()]);
      await vi.advanceTimersByTimeAsync(999);
      expect(mock.callCount).toBe(1);
      await vi.advanceTimersByTimeAsync(1000);
      expect(mock.callCount).toBe(2);
      await vi.advanceTimersByTimeAsync(1);
      await two;
    } finally {
      vi.useRealTimers();
    }
  });

  it('resumes a manually selected static bucket without adaptive pacing', async () => {
    vi.useFakeTimers();
    try {
      const mock = createMockFetch((_request, index) =>
        index === 0
          ? json({}, { status: 429, headers: { 'X-RateLimit-Scope': 'chat', 'Retry-After': '1' } })
          : json({ message_id: 'm' }),
      );
      await using client = createRestClient({
        ...clientOptions,
        fetch: mock.fetch,
        rateLimit: { retryDelays: [] },
      });
      const send = () =>
        client.chats.sendMessage('a', { text: 'test' }, { rateLimitBucket: 'feed' });
      await expect(send()).rejects.toMatchObject({ status: 429 });
      const pending = Promise.all([send(), send()]);
      await vi.advanceTimersByTimeAsync(999);
      expect(mock.callCount).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      await pending;
      expect(mock.callCount).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('restores the configured burst after a rejection using the rate from the server', async () => {
    vi.useFakeTimers();
    try {
      const mock = createMockFetch((_request, i) =>
        i === 2
          ? json(
              {},
              {
                status: 429,
                headers: {
                  'X-RateLimit-Scope': 'chat',
                  'X-RateLimit-Limit': '60',
                  'X-RateLimit-Remaining': '0',
                  'Retry-After': '5',
                },
              },
            )
          : json({ message_id: 'm' }),
      );
      await using client = createRestClient({
        ...clientOptions,
        fetch: mock.fetch,
        rateLimit: { retryDelays: [], bucketOverrides: { 'chats.send': { burst: 3 } } },
      });
      const send = () => client.chats.sendMessage('chat', { text: 'test' });
      await send();
      await send();
      await expect(send()).rejects.toMatchObject({ status: 429 });
      // После конца паузы успел восстановиться ещё один токен.
      await vi.advanceTimersByTimeAsync(6000);
      const first = Promise.all([send(), send(), send()]);
      await vi.advanceTimersByTimeAsync(999);
      expect(mock.callCount).toBe(5);
      await vi.advanceTimersByTimeAsync(1);
      await first;

      await vi.advanceTimersByTimeAsync(60_000);
      const second = Promise.all([send(), send(), send(), send()]);
      await vi.advanceTimersByTimeAsync(999);
      expect(mock.callCount).toBe(9);
      await vi.advanceTimersByTimeAsync(1);
      await second;
    } finally {
      vi.useRealTimers();
    }
  });

  it('refunds a rejected batch forward when the server also changes the refill rate', async () => {
    vi.useFakeTimers();
    try {
      const mock = createMockFetch((_request, i) =>
        i === 0
          ? json(
              {},
              {
                status: 429,
                headers: {
                  'X-RateLimit-Scope': 'chat',
                  'X-RateLimit-Limit': '60',
                  'Retry-After': '1',
                },
              },
            )
          : json({ message_id: 'm' }),
      );
      await using client = createRestClient({
        ...clientOptions,
        fetch: mock.fetch,
        rateLimit: { retryDelays: [] },
      });
      await expect(
        client.chats.forwardMessages('target', {
          sourceChatId: 'source',
          messageIds: Array.from({ length: 60 }, (_, i) => String(i)),
        }),
      ).rejects.toMatchObject({ status: 429 });
      const next = client.chats.sendMessage('target', { text: 'test' });
      await vi.advanceTimersByTimeAsync(999);
      expect(mock.callCount).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      await next;
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    { initial: 60, updated: 6, elapsed: 0, wait: 10_000 },
    { initial: 60, updated: 6, elapsed: 250, wait: 7500 },
    { initial: 6, updated: 60, elapsed: 2500, wait: 750 },
  ])(
    'reschedules a waiting send when only Limit changes from $initial to $updated',
    async ({ initial, updated, elapsed, wait }) => {
      vi.useFakeTimers();
      try {
        let respond!: (response: Response) => void;
        const firstResponse = new Promise<Response>((resolve) => {
          respond = resolve;
        });
        const mock = createMockFetch((_request, i) =>
          i === 0 ? firstResponse : json({ message_id: 'm' }),
        );
        await using client = createRestClient({
          ...clientOptions,
          fetch: mock.fetch,
          rateLimit: { bucketOverrides: { 'chats.send': { limit: initial, burst: 1 } } },
        });
        const send = () => client.chats.sendMessage('target', { text: 'test' });
        const first = send();
        const second = send();
        await vi.advanceTimersByTimeAsync(elapsed);
        expect(mock.callCount).toBe(1);
        respond(json({ message_id: 'm' }, { headers: { 'X-RateLimit-Limit': String(updated) } }));
        await first;
        await vi.advanceTimersByTimeAsync(wait - 1);
        expect(mock.callCount).toBe(1);
        await vi.advanceTimersByTimeAsync(1);
        await second;
        expect(mock.callCount).toBe(2);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it('pauses a chat on 429 headers and extends the same pause from the body', async () => {
    vi.useFakeTimers();
    try {
      let rejectionBody!: ReadableStreamDefaultController<string>;
      const body = new ReadableStream<string>({
        start(controller) {
          rejectionBody = controller;
        },
      }).pipeThrough(new TextEncoderStream());
      let finishConcurrent!: (response: Response) => void;
      const concurrent = new Promise<Response>((resolve) => {
        finishConcurrent = resolve;
      });
      const mock = createMockFetch((_request, index) => {
        if (index === 0) {
          return new Response(body, {
            status: 429,
            headers: {
              'content-type': 'application/json',
              'Retry-After': '1',
              'X-RateLimit-Scope': RateLimitErrorScope.Chat,
            },
          });
        }
        return index === 1 ? concurrent : json({ message_id: 'm' });
      });
      await using client = createRestClient({
        ...clientOptions,
        fetch: mock.fetch,
        rateLimit: { concurrency: 2, retryDelays: [] },
      });
      const send = () => client.chats.sendMessage('target', { text: 'test' });
      const rejected = expect(send()).rejects.toMatchObject({ status: 429, retryAfter: 2000 });
      const active = send();
      const pending = send();
      await vi.advanceTimersByTimeAsync(0);
      expect(mock.callCount).toBe(2);

      finishConcurrent(json({ message_id: 'm' }));
      await active;
      expect(mock.callCount).toBe(2);
      await vi.advanceTimersByTimeAsync(500);
      rejectionBody.enqueue('{"retryAfter":2}');
      rejectionBody.close();
      await rejected;
      await vi.advanceTimersByTimeAsync(1499);
      expect(mock.callCount).toBe(2);
      await vi.advanceTimersByTimeAsync(1);
      await pending;
      expect(mock.callCount).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([RateLimitErrorScope.IpFlood, RateLimitErrorScope.GlobalFlood])(
    'shares the %s pause across accounts on the same origin',
    async (scope) => {
      vi.useFakeTimers();
      try {
        const mock = createMockFetch((_request, index) =>
          index === 0
            ? json(
                {},
                {
                  status: 429,
                  headers: {
                    'Retry-After': '1',
                    'X-RateLimit-Scope': scope,
                    'X-RateLimit-Limit': '80',
                    'X-RateLimit-Remaining': '0',
                  },
                },
              )
            : json({ version: '1' }),
        );
        await using accounts = new ItdAccounts({
          baseUrl: clientOptions.baseUrl,
          fetch: mock.fetch,
          retry: false,
          rateLimit: { retryDelays: [], pacing: RateLimitPacing.Off },
        });
        const first = accounts.addAccount('a', { auth: 'token-a' });
        const second = accounts.addAccount('b', { auth: 'token-b' });

        await expect(first.chats.sendMessage('chat', { text: 'test' })).rejects.toMatchObject({
          status: 429,
          scope,
        });
        expect(first.rateLimitState()[0]).toMatchObject({ bucket: 'chats.send', limit: undefined });
        const pending = second.platform.version();
        await second.request({ method: 'GET', path: '/ping', baseUrl: 'https://other.test' });
        await vi.advanceTimersByTimeAsync(999);
        expect(mock.callCount).toBe(2);
        await vi.advanceTimersByTimeAsync(1);
        await pending;
        expect(mock.calls.at(-1)?.url).toContain('/platform/version');
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it.each([RateLimitErrorScope.IpFlood, RateLimitErrorScope.GlobalFlood])(
    'holds an already queued chat through the fallback delay for %s',
    async (scope) => {
      vi.useFakeTimers();
      try {
        let finishFirst!: (response: Response) => void;
        const first = new Promise<Response>((resolve) => {
          finishFirst = resolve;
        });
        const mock = createMockFetch((_request, index) =>
          index === 0 ? first : json({ message_id: 'm' }),
        );
        await using client = createRestClient({
          ...clientOptions,
          fetch: mock.fetch,
          rateLimit: { concurrency: 1, retryDelays: [1000] },
        });
        const retry = client.chats.sendMessage('one', { text: 'retry' });
        const other = client.chats.sendMessage('two', { text: 'other' });
        await vi.advanceTimersByTimeAsync(0);
        expect(client.rateLimitState()).toContainEqual(
          expect.objectContaining({
            instance: 'chat:two',
            pending: 1,
          }),
        );
        finishFirst(json({}, { status: 429, headers: { 'X-RateLimit-Scope': scope } }));
        await vi.advanceTimersByTimeAsync(999);
        expect(mock.callCount).toBe(1);
        await vi.advanceTimersByTimeAsync(1);
        await Promise.all([retry, other]);
        expect(mock.callCount).toBe(3);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it('returns the new-recipient limit without retrying or delaying another recipient', async () => {
    const mock = createMockFetch([
      json(
        {},
        {
          status: 429,
          headers: {
            'X-RateLimit-Retry-After-Ms': '50',
            'X-RateLimit-Scope': RateLimitErrorScope.NewRecipientsDay,
          },
        },
      ),
      json({ chat_id: 'second', message_id: 'm' }),
    ]);
    await using client = createRestClient({
      ...clientOptions,
      fetch: mock.fetch,
      rateLimit: { retryDelays: [100] },
    });

    await expect(client.chats.sendMessageToUser('first', { text: 'test' })).rejects.toMatchObject({
      status: 429,
      scope: RateLimitErrorScope.NewRecipientsDay,
      retryAfter: 50,
    });
    await client.chats.sendMessageToUser('second', { text: 'test' });
    expect(mock.calls.map(({ url }) => url)).toEqual([
      fromMessenger('/users/first/messages'),
      fromMessenger('/users/second/messages'),
    ]);
  });

  it('uploads builder attachments before sending markup and a feed post', async () => {
    const mock = createMockFetch([
      json({ uploadId: 'upload' }),
      noContent(),
      json({ fileId: 'uploaded' }),
      json({ message_id: 'm1' }),
      json({ message_id: 'm1' }),
    ]);
    const itd = createRestClient({ ...clientOptions, fetch: mock.fetch, rateLimit: {} });
    const draft = buildMessage().post('p1').attachId('existing');
    try {
      await itd.chats.sendMessage(
        'first',
        draft
          .markup((m) => m.bold('hello'))
          .attach(new Uint8Array([1]))
          .replyTo('m0'),
      );
      expect(mock.calls.map(({ url }) => url.replace(fromMessenger(''), ''))).toEqual([
        '/media/upload/init',
        '/media/upload/upload/part/0',
        '/media/upload/upload/finalize',
        '/chats/first/messages',
      ]);
      expect(itd.rateLimitState().map(({ bucket }) => bucket)).toEqual(['chats', 'chats.send']);
      expect(JSON.parse(mock.calls[3]?.body ?? '{}')).toEqual({
        text: 'hello',
        reply_to_id: 'm0',
        attachments: ['existing', 'uploaded'],
        entities: [
          { type: 'bold', offset: 0, length: 5 },
          { type: 'post', post_id: 'p1' },
        ],
      });
      await itd.chats.editMessage('first', 'm1', (m) =>
        m
          .markup((f) => f.bold('old'))
          .text('new')
          .clearAttachments(),
      );
      expect(JSON.parse(mock.calls[4]?.body ?? '{}')).toEqual({
        text: 'new',
        attachments: [],
        entities: [],
      });
      expect(draft.build()).toEqual({
        text: '',
        attachmentIds: ['existing'],
        entities: [{ type: 'post', postId: 'p1' }],
      });
    } finally {
      await itd.close();
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
