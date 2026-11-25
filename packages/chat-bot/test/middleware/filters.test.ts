import { type ChatMessage, ChatUpdateType } from 'itd-api';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { ChatBotFilter, ChatComposer, ChatContext } from '../../src/index.js';
import { setup } from '../helpers/bot.fixtures.js';

function message(fields: Partial<ChatMessage>): ChatMessage {
  return {
    messageId: 'm1',
    senderId: 'u1',
    createdAt: '2026-11-20T00:00:00.000Z',
    ...fields,
  };
}

describe('Фильтры по содержимому сообщения', () => {
  it('распознаёт медиа и карточку поста, включая их сочетание в одном сообщении', async () => {
    const { itd } = setup();
    const composer = new ChatComposer();
    const seen: string[] = [];
    for (const filter of [
      ChatBotFilter.MessageAttachment,
      ChatBotFilter.MessageImage,
      ChatBotFilter.MessageVideo,
      ChatBotFilter.MessageAudio,
      ChatBotFilter.MessagePost,
    ]) {
      composer.on(filter, async (ctx, next) => {
        expectTypeOf(ctx.messageId).toEqualTypeOf<string>();
        seen.push(filter);
        await next();
      });
    }
    const run = composer.middleware();
    const imageAndPost = message({
      attachments: [
        { fileId: 'f1', url: '/file', mime: null },
        { fileId: 'f2', url: '/file', mime: 'IMAGE/jpeg' },
      ],
      entities: [{ type: 'post', postId: 'p1' }],
    });
    const incoming = { type: ChatUpdateType.NewMessage };
    const next = async () => {};
    try {
      await run(new ChatContext(itd, incoming, imageAndPost), next);
      expect(seen.splice(0)).toEqual([
        ChatBotFilter.MessageAttachment,
        ChatBotFilter.MessageImage,
        ChatBotFilter.MessagePost,
      ]);

      const media = message({
        attachments: [
          { fileId: 'f1', url: '/video', mime: 'video/mp4' },
          { fileId: 'f2', url: '/voice', mime: 'audio/ogg' },
        ],
        entities: [{ type: 'bold', offset: 0, length: 1 }],
      });
      await run(new ChatContext(itd, incoming, media), next);
      expect(seen.splice(0)).toEqual([
        ChatBotFilter.MessageAttachment,
        ChatBotFilter.MessageVideo,
        ChatBotFilter.MessageAudio,
      ]);

      const file = message({ attachments: [{ fileId: 'f1', url: '/file', filename: 'x.jpg' }] });
      await run(new ChatContext(itd, incoming, file), next);
      expect(seen.splice(0)).toEqual([ChatBotFilter.MessageAttachment]);

      await run(new ChatContext(itd, { type: ChatUpdateType.OwnMessages }, imageAndPost), next);
      expect(seen).toEqual([]);
    } finally {
      await itd.close();
    }
  });

  it('отличает голосовое от аудиофайла и находит пересылку по одному ID оригинала', async () => {
    const { itd } = setup();
    const composer = new ChatComposer();
    const voice = vi.fn();
    const forwardedVoice = vi.fn();
    const audio = vi.fn();
    composer.on(ChatBotFilter.MessageVoice, (ctx, next) => {
      voice(ctx.messageId);
      return next();
    });
    composer.on(ChatBotFilter.MessageForward).on(ChatBotFilter.MessageVoice, (ctx, next) => {
      forwardedVoice(ctx.messageId);
      return next();
    });
    composer.on(ChatBotFilter.MessageAudio, (ctx) => audio(ctx.messageId));
    const run = composer.middleware();
    const attachments = [{ fileId: 'f1', url: '/voice', mime: 'audio/webm', waveform: 'AA==' }];
    const cases = {
      voice: { attachments },
      byChat: { attachments, forwardedFromChatId: 'c2' },
      byMessage: { attachments, forwardedFromMessageId: 'original' },
      audio: {
        forwardedFromChatId: 'c2',
        attachments: [
          { fileId: 'f1', url: '/audio', mime: 'audio/ogg' },
          { fileId: 'f2', url: '/image', mime: 'image/png', waveform: 'AA==' },
        ],
      },
    };
    try {
      for (const [messageId, fields] of Object.entries(cases)) {
        await run(
          new ChatContext(
            itd,
            { type: ChatUpdateType.NewMessage },
            message({ ...fields, messageId }),
          ),
          async () => {},
        );
      }
      expect(voice.mock.calls).toEqual([['voice'], ['byChat'], ['byMessage']]);
      expect(forwardedVoice.mock.calls).toEqual([['byChat'], ['byMessage']]);
      expect(audio.mock.calls).toEqual([['voice'], ['byChat'], ['byMessage'], ['audio']]);
    } finally {
      await itd.close();
    }
  });
});
