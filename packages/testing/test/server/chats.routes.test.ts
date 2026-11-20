import { ItdClient } from 'itd-api';
import { expect, it } from 'vitest';
import { createMockServer } from '../../src/index.js';

it('хранит личный диалог и позиции чтения отдельно для участников', async () => {
  const server = createMockServer({
    seed: {
      users: [
        { id: 'alice', username: 'alice' },
        { id: 'bob', username: 'bob' },
        { id: 'eve', username: 'eve' },
      ],
    },
  });
  const alice = new ItdClient(server.clientOptions({ as: 'alice' }));
  const bob = new ItdClient(server.clientOptions({ as: 'bob' }));
  const eve = new ItdClient(server.clientOptions({ as: 'eve' }));
  try {
    const first = await alice.chats.sendMessageToUser('bob', { text: 'Привет' });
    const { chatId } = first;
    expect(await bob.chats.createDirect('alice')).toEqual({ chatId, created: false });
    const second = await alice.chats.sendMessage(chatId, { text: 'Как дела?' });
    expect((await bob.chats.list()).chats[0]).toMatchObject({ chatId, unreadCount: 2 });
    const history = await bob.chats.iterateMessages(chatId, { limit: 1 }).collect();
    expect(history.map(({ messageId }) => messageId)).toEqual([second.messageId, first.messageId]);
    expect(await bob.chats.markRead(chatId, second.messageId)).toMatchObject({
      remainingUnread: 0,
    });
    expect(await alice.chats.get(chatId)).toMatchObject({
      otherReadMessageId: second.messageId,
      myReadMessageId: null,
    });
    await expect(eve.chats.get(chatId)).rejects.toMatchObject({ status: 404 });
    server.assertNoUnsupportedRequests();
    server.reset();
    expect((await bob.chats.list()).chats).toEqual([]);
  } finally {
    await Promise.all([alice.close(), bob.close(), eve.close()]);
  }
});
