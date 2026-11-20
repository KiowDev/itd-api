import type { ChatSummary } from 'itd-api';
import type { ResourceAction } from '../../actions/action.types.js';
import type { HydratedModel } from '../model.types.js';

/** Действия, привязанные к идентификатору чата. */
export interface HydratedChatActions {
  /** Загружает страницу истории чата. */
  readonly getMessages: ResourceAction<'chats', 'messages'>;
  /** Отправляет сообщение в чат. */
  readonly sendMessage: ResourceAction<'chats', 'sendMessage'>;
  /** Отмечает историю прочитанной до переданного сообщения. */
  readonly markRead: ResourceAction<'chats', 'markRead'>;
}

/** Сводка чата с действиями. */
export type HydratedChat<T extends ChatSummary = ChatSummary> = HydratedModel<'chat', T>;
