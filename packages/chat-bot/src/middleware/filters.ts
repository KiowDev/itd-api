import { ChatUpdateType } from 'itd-api';
import { type ChatContext, incomingChatCreatedContexts } from '../context/context.js';
import { ChatBotFilter } from './filters.enum.js';
import type { ChatFilterContext, ChatMessageContext } from './filters.types.js';

/** Проверяет, что контекст относится к входящему сообщению. @internal */
export function isIncomingMessage<C extends ChatContext>(
  context: C,
): context is ChatMessageContext<C> {
  const { type } = context.update;
  return (
    context.message !== undefined &&
    (type === ChatUpdateType.NewMessage ||
      type === ChatUpdateType.NewMessages ||
      (type === ChatUpdateType.ChatCreated && incomingChatCreatedContexts.has(context)))
  );
}

/** Проверяет соответствие контекста хотя бы одному фильтру. */
export function matchesChatFilter<C extends ChatContext, F extends ChatBotFilter>(
  context: C,
  query: F | readonly F[],
): context is ChatFilterContext<C, F> {
  const filters = typeof query === 'string' ? [query] : query;
  return filters.some((filter) => matchesFilter(context, filter));
}

function matchesFilter(context: ChatContext, filter: ChatBotFilter): boolean {
  switch (filter) {
    case ChatBotFilter.Message:
      return isIncomingMessage(context);
    case ChatBotFilter.MessageText:
      return isIncomingMessage(context) && typeof context.text === 'string';
    case ChatBotFilter.MessageAttachment:
      return isIncomingMessage(context) && Boolean(context.message.attachments?.length);
    case ChatBotFilter.MessageImage:
      return hasMedia(context, 'image/');
    case ChatBotFilter.MessageVideo:
      return hasMedia(context, 'video/');
    case ChatBotFilter.MessageAudio:
      return hasMedia(context, 'audio/');
    case ChatBotFilter.MessageVoice:
      return (
        isIncomingMessage(context) &&
        (context.message.attachments?.some(
          ({ mime, waveform }) => Boolean(waveform) && mime?.toLowerCase().startsWith('audio/'),
        ) ??
          false)
      );
    case ChatBotFilter.MessagePost:
      return (
        isIncomingMessage(context) &&
        (context.message.entities?.some((entity) => entity.type === 'post') ?? false)
      );
    case ChatBotFilter.MessageReply:
      return isIncomingMessage(context) && context.message.replyTo != null;
    case ChatBotFilter.MessageForward:
      return (
        isIncomingMessage(context) &&
        Boolean(context.message.forwardedFromMessageId || context.message.forwardedFromChatId)
      );
    case ChatBotFilter.Edit:
      return context.update.type === ChatUpdateType.MessageEdited;
    case ChatBotFilter.Read:
      return context.update.type === ChatUpdateType.MessagesRead;
    default:
      return context.update.type === filter;
  }
}

function hasMedia(context: ChatContext, prefix: string): boolean {
  return (
    isIncomingMessage(context) &&
    (context.message.attachments?.some(({ mime }) => mime?.toLowerCase().startsWith(prefix)) ??
      false)
  );
}
