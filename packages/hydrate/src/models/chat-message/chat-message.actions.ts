import type { RequestOptions, SendChatMessageInput } from 'itd-api';
import type { ModelAction } from '../../actions/action.types.js';
import { modelContext } from '../../runtime/context.utils.js';
import type { AnyRecord } from '../../runtime/records.types.js';
import { stringProperty } from '../../runtime/records.utils.js';
import { ModelKind } from '../model.constants.js';
import type { HydratedChatMessageActions } from './chat-message.types.js';

const CHAT_IDS = new WeakMap<object, string>();

/** Связывает сообщение с чатом, ID которого был передан при чтении истории. */
export function rememberMessageChat(
  model: object,
  [chatId]: readonly unknown[],
  kind: ModelKind,
): void {
  if (kind === ModelKind.ChatMessage && typeof chatId === 'string') CHAT_IDS.set(model, chatId);
}

function chatIdOf(model: AnyRecord): string {
  const chatId = CHAT_IDS.get(model);
  if (chatId === undefined) throw new TypeError('Неизвестен чат, из которого получено сообщение');
  return chatId;
}

function messageIdOf(model: AnyRecord): string {
  return stringProperty(model, 'messageId', 'идентификатор сообщения');
}

function messageAction(method: 'editMessage' | 'markRead' | 'reactions'): ModelAction {
  return function action(this: AnyRecord, ...args: unknown[]): unknown {
    const { chats } = modelContext(this).facade;
    return Reflect.apply(chats[method], chats, [chatIdOf(this), messageIdOf(this), ...args]);
  };
}

function deleteAction(method: 'deleteMessagesForMe' | 'deleteMessagesForAll'): ModelAction {
  return function action(this: AnyRecord, options: unknown): unknown {
    const { chats } = modelContext(this).facade;
    return chats[method](
      chatIdOf(this),
      [messageIdOf(this)],
      options as RequestOptions | undefined,
    );
  };
}

export const CHAT_MESSAGE_ACTIONS = Object.freeze({
  reply(this: AnyRecord, input: unknown, options?: unknown) {
    const { chats } = modelContext(this).facade;
    return chats.sendMessage(
      chatIdOf(this),
      { ...(input as SendChatMessageInput), replyToId: messageIdOf(this) },
      options as RequestOptions | undefined,
    );
  },
  edit: messageAction('editMessage'),
  markRead: messageAction('markRead'),
  deleteForMe: deleteAction('deleteMessagesForMe'),
  deleteForAll: deleteAction('deleteMessagesForAll'),
  getReactions: messageAction('reactions'),
} satisfies Record<keyof HydratedChatMessageActions, ModelAction>);
