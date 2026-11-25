import { ChatReactionType, ChatUpdateType, TimeoutBudget } from 'itd-api';
import { describe, expect, it, vi } from 'vitest';
import { ChatContext } from '../../src/index.js';
import { setup } from '../helpers/bot.fixtures.js';

const update = { type: ChatUpdateType.NewMessage, chatId: 'c1', messageId: 'm1' };
const newMessage = {
  messageId: 'm1',
  senderId: 'u1',
  createdAt: '2026-11-20T00:00:00Z',
  reactions: [],
  reactionVersion: '0',
};
const thumbsUp = { type: ChatReactionType.Emoji, emoji: '👍' };
const heart = { type: ChatReactionType.Emoji, emoji: '❤️' };
const custom = { type: ChatReactionType.Custom, file_id: 'file-1' };

function state(version: string, ...reactions: { reaction: object; chosen: boolean }[]) {
  return Response.json({
    message_id: 'm1',
    reaction_version: version,
    reactions: reactions.map((entry) => ({ count: 1, ...entry })),
  });
}

function conflict() {
  return Response.json({ error: { code: 'CONFLICT', message: 'internal error' } }, { status: 409 });
}

describe('ChatContext.react()', () => {
  it('использует версию пустого списка из события без чтения', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(state('1'));
    const { itd } = setup(fetch);
    try {
      await expect(new ChatContext(itd, update, newMessage).react('👍')).resolves.toMatchObject({
        reactionVersion: '1',
      });
      expect(fetch).toHaveBeenCalledOnce();
      const request = fetch.mock.calls[0]?.[1];
      expect(request?.method).toBe('PUT');
      expect(JSON.parse(String(request?.body))).toEqual({
        reactions: [thumbsUp],
        expected_version: '0',
        operation_id: expect.any(String),
      });
    } finally {
      await itd.close();
    }
  });

  it('после конфликта перечитывает состояние и сохраняет только свой выбор', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(conflict())
      .mockResolvedValueOnce(
        state('1', { reaction: custom, chosen: true }, { reaction: heart, chosen: false }),
      )
      .mockResolvedValueOnce(state('2', { reaction: thumbsUp, chosen: true }));
    const { itd } = setup(fetch);
    const read = vi.spyOn(itd.chats, 'reactions');
    try {
      await new ChatContext(itd, update, newMessage).react('👍');
      expect(fetch.mock.calls.map(([, request]) => request?.method)).toEqual(['PUT', 'GET', 'PUT']);
      expect(read).toHaveBeenCalledWith('c1', 'm1', { extensions: { cache: 'reload' } });
      const first = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
      const last = JSON.parse(String(fetch.mock.calls[2]?.[1]?.body));
      expect(last).toEqual({
        reactions: [custom, thumbsUp],
        expected_version: '1',
        operation_id: expect.any(String),
      });
      expect(last.operation_id).not.toBe(first.operation_id);
    } finally {
      await itd.close();
    }
  });

  it('без версии читает состояние и пропускает запись уже выбранной реакции', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(state('4', { reaction: custom, chosen: true }));
    const { itd } = setup(fetch);
    try {
      const { reactionVersion: _version, ...message } = newMessage;
      const ctx = new ChatContext(itd, update, message);
      await expect(
        ctx.react({ type: ChatReactionType.Custom, fileId: 'file-1' }),
      ).resolves.toMatchObject({
        reactionVersion: '4',
      });
      expect(fetch.mock.calls.map(([, request]) => request?.method)).toEqual(['GET']);
    } finally {
      await itd.close();
    }
  });

  it('после сетевой ошибки записи подтверждает результат чтением', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValueOnce(new TypeError('connection lost'))
      .mockResolvedValueOnce(state('1', { reaction: thumbsUp, chosen: true }));
    const { itd } = setup(fetch);
    try {
      await expect(new ChatContext(itd, update, newMessage).react('👍')).resolves.toMatchObject({
        reactionVersion: '1',
      });
      expect(fetch.mock.calls.map(([, request]) => request?.method)).toEqual(['PUT', 'GET']);
    } finally {
      await itd.close();
    }
  });

  it('не повторяет запись после второго конфликта', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(conflict())
      .mockResolvedValueOnce(state('1'))
      .mockResolvedValueOnce(conflict());
    const { itd } = setup(fetch);
    try {
      await expect(new ChatContext(itd, update, newMessage).react('👍')).rejects.toMatchObject({
        status: 409,
      });
      expect(fetch.mock.calls.map(([, request]) => request?.method)).toEqual(['PUT', 'GET', 'PUT']);
    } finally {
      await itd.close();
    }
  });

  it('учитывает время чтения в общем сроке операции', async () => {
    let elapsed = 0;
    const now = vi.spyOn(performance, 'now').mockImplementation(() => elapsed);
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => {
      elapsed = 10000;
      return state('4');
    });
    const { itd } = setup(fetch);
    try {
      await expect(
        new ChatContext(itd, update).react('👍', { deadline: 5000 }),
      ).rejects.toMatchObject({
        budget: TimeoutBudget.Deadline,
      });
      expect(fetch.mock.calls.map(([, request]) => request?.method)).toEqual(['GET']);
    } finally {
      now.mockRestore();
      await itd.close();
    }
  });

  it('останавливает запись при отмене контекста после чтения', async () => {
    const { itd } = setup();
    const controller = new AbortController();
    const cancelled = new Error('Обработка остановлена');
    vi.spyOn(itd.chats, 'reactions').mockImplementation(async () => {
      controller.abort(cancelled);
      return { messageId: 'm1', reactions: [], reactionVersion: '0' };
    });
    const write = vi.spyOn(itd.chats, 'setReactions');
    try {
      const ctx = new ChatContext(itd, update, undefined, controller.signal);
      await expect(ctx.react('👍')).rejects.toBe(cancelled);
      expect(write).not.toHaveBeenCalled();
    } finally {
      await itd.close();
    }
  });
});
