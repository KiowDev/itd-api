import type { ChatsApi, ItdClient, SendChatMessageInput, UserId } from 'itd-api';

/** Клиент с ресурсом и каналом событий чатов. */
export interface ChatBotClient extends Pick<ItdClient, 'install'> {
  /** Позволяет отличить сообщения бота от сообщений собеседника. */
  readonly getUserId?: () => Promise<UserId | undefined>;
  /** Загружает текущий профиль и, если доступен `get()`, профиль автора сообщения. */
  readonly users?: Pick<ItdClient['users'], 'me'> & Partial<Pick<ItdClient['users'], 'get'>>;
  /** Запросы чатов и канал обновлений, которые использует бот. */
  readonly chats: Pick<
    ChatsApi,
    | 'events'
    | 'list'
    | 'get'
    | 'sendMessage'
    | 'editMessage'
    | 'forwardMessages'
    | 'markRead'
    | 'acceptRequest'
    | 'sendAction'
    | 'uploadFile'
  >;
}

/** Дополнительные поля текстового ответа. */
export type ChatReplyOptions = Omit<SendChatMessageInput, 'text' | 'replyToId'>;
