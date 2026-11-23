import { type ChatMessage, type ChatUpdate, ChatUpdateType } from 'itd-api';
import type { ChatContext } from './context.js';

/** Фильтры по содержимому сообщения и действиям в чате. */
export const ChatBotFilter = Object.freeze({
  Message: 'message',
  MessageText: 'message:text',
  MessageAttachment: 'message:attachment',
  MessageReply: 'message:reply',
  MessageForward: 'message:forward',
  Edit: 'edit',
  Read: 'read',
} as const);

type KnownUpdateType = (typeof ChatUpdateType)[keyof typeof ChatUpdateType];
export type ChatBotFilter = KnownUpdateType | (typeof ChatBotFilter)[keyof typeof ChatBotFilter];
export type ChatBotFilterQuery = ChatBotFilter | readonly ChatBotFilter[];

type IncomingType =
  | typeof ChatUpdateType.NewMessage
  | typeof ChatUpdateType.NewMessages
  | typeof ChatUpdateType.ChatCreated;
type ContextWithUpdate<C, T extends KnownUpdateType> = C & { update: ChatUpdate & { type: T } };

/** Контекст входящего сообщения. */
export type ChatMessageContext<C extends ChatContext = ChatContext> = ContextWithUpdate<
  C,
  IncomingType
> & { message: ChatMessage };

/** Контекст, соответствующий указанному фильтру. */
export type ChatFilterContext<
  C extends ChatContext,
  F extends ChatBotFilter,
> = F extends typeof ChatBotFilter.MessageText
  ? ChatMessageContext<C> & { text: string }
  : F extends typeof ChatBotFilter.Message | `message:${string}`
    ? ChatMessageContext<C>
    : F extends typeof ChatBotFilter.Edit
      ? ContextWithUpdate<C, typeof ChatUpdateType.MessageEdited>
      : F extends typeof ChatBotFilter.Read
        ? ContextWithUpdate<C, typeof ChatUpdateType.MessagesRead>
        : F extends KnownUpdateType
          ? ContextWithUpdate<C, F>
          : never;

/** Контексты входящих сообщений из `chat_created`. @internal */
export const incomingChatCreatedContexts = new WeakSet<ChatContext>();

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
    case ChatBotFilter.MessageReply:
      return isIncomingMessage(context) && context.message.replyTo != null;
    case ChatBotFilter.MessageForward:
      return isIncomingMessage(context) && Boolean(context.message.forwardedFromMessageId);
    case ChatBotFilter.Edit:
      return context.update.type === ChatUpdateType.MessageEdited;
    case ChatBotFilter.Read:
      return context.update.type === ChatUpdateType.MessagesRead;
    default:
      return context.update.type === filter;
  }
}
