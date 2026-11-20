import type {
  ChatDeletedMessages,
  ChatEditedMessage,
  ChatMessage,
  ChatMessageContent,
  ChatMessageReactions,
  ChatReadResult,
  ChatSentMessage,
  RequestOptions,
  SendChatMessageInput,
} from 'itd-api';
import type { HydratedModel } from '../model.types.js';

/** Действия над сообщением с подставленными ID чата и сообщения. */
export interface HydratedChatMessageActions {
  /** Отправляет ответ на это сообщение. */
  reply(
    input: Omit<SendChatMessageInput, 'replyToId'>,
    options?: RequestOptions,
  ): Promise<ChatSentMessage>;
  /** Меняет содержимое сообщения. */
  edit(input: ChatMessageContent, options?: RequestOptions): Promise<ChatEditedMessage>;
  /** Отмечает историю прочитанной до этого сообщения. */
  markRead(options?: RequestOptions): Promise<ChatReadResult>;
  /** Удаляет сообщение из своей истории. */
  deleteForMe(options?: RequestOptions): Promise<ChatDeletedMessages>;
  /** Удаляет сообщение у всех участников. */
  deleteForAll(options?: RequestOptions): Promise<ChatDeletedMessages>;
  /** Получает текущее состояние реакций на сообщение. */
  getReactions(options?: RequestOptions): Promise<ChatMessageReactions>;
}

/** Сообщение с действиями. */
export type HydratedChatMessage<T extends ChatMessage = ChatMessage> = HydratedModel<
  'chat-message',
  T
>;
