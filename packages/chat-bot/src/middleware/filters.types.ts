import type { ChatMessage, ChatUpdate, ChatUpdateType } from 'itd-api';
import type { ChatContext } from '../context/context.js';
import type { ChatBotFilter, KnownUpdateType } from './filters.enum.js';

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
