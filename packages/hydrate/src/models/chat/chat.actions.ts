import { resourceAction } from '../../actions/action.factory.js';
import type { ModelAction } from '../../actions/action.types.js';
import type { AnyRecord } from '../../runtime/records.types.js';
import { stringProperty } from '../../runtime/records.utils.js';
import type { HydratedChatActions } from './chat.types.js';

function chatId(target: AnyRecord): string {
  return stringProperty(target, 'chatId', 'идентификатор чата');
}

export const CHAT_ACTIONS = Object.freeze({
  getMessages: resourceAction('chats', 'messages', chatId),
  sendMessage: resourceAction('chats', 'sendMessage', chatId),
  markRead: resourceAction('chats', 'markRead', chatId),
} satisfies Record<keyof HydratedChatActions, ModelAction>);
