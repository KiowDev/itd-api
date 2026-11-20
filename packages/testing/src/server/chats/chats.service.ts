import { MockDomainError } from '../shared/domain.errors.js';

interface StoredMessage {
  message_id: string;
  sender_id: string;
  created_at: string;
  text: string;
}

interface DirectChat {
  readonly id: string;
  readonly users: readonly [string, string];
  readonly messages: StoredMessage[];
  readonly read: Map<string, string>;
}

/** Состояние личных диалогов mock-server. */
export class ChatService {
  readonly #chats = new Map<string, DirectChat>();
  readonly #now: () => string;
  #messageNumber = 0;

  constructor(now: () => string) {
    this.#now = now;
  }

  reset(): void {
    this.#chats.clear();
    this.#messageNumber = 0;
  }

  /** Открывает один личный диалог для пары пользователей. */
  open(userId: string, targetId: string) {
    for (const chat of this.#chats.values()) {
      if (chat.users.includes(userId) && chat.users.includes(targetId)) {
        return { chat_id: chat.id, created: false };
      }
    }
    const id = `chat-${this.#chats.size + 1}`;
    this.#chats.set(id, { id, users: [userId, targetId], messages: [], read: new Map() });
    return { chat_id: id, created: true };
  }

  list(userId: string, before: string | null, limit: number) {
    const chats = [...this.#chats.values()].filter((chat) => chat.users.includes(userId)).reverse();
    const start = before ? chats.findIndex(({ id }) => id === before) + 1 : 0;
    if (before && start === 0) throw MockDomainError.validation('Неизвестный курсор чатов');
    const page = chats.slice(start, start + limit);
    return {
      chats: page.map((chat) => this.#summary(chat, userId)),
      next_before: start + limit < chats.length ? (page.at(-1)?.id ?? null) : null,
    };
  }

  get(chatId: string, userId: string) {
    return this.#summary(this.#requireChat(chatId, userId), userId);
  }

  messages(chatId: string, userId: string, before: string | null, limit: number) {
    const chat = this.#requireChat(chatId, userId);
    const start = before ? this.#messageIndex(chat, before) + 1 : 0;
    const ownRead = chat.read.get(userId);
    return {
      messages: chat.messages.slice(start, start + limit),
      read_cursors: Object.fromEntries(
        [...chat.read].map(([id, message_id]) => [id, { message_id }]),
      ),
      my_last_read: ownRead ? { message_id: ownRead } : null,
    };
  }

  send(chatId: string, userId: string, text: string) {
    const chat = this.#requireChat(chatId, userId);
    const message_id = `message-${++this.#messageNumber}`;
    const created_at = this.#now();
    chat.messages.unshift({ message_id, sender_id: userId, created_at, text });
    return { message_id, created_at, attachments: [] };
  }

  markRead(chatId: string, userId: string, messageId: string) {
    const chat = this.#requireChat(chatId, userId);
    const index = this.#messageIndex(chat, messageId);
    const previous = chat.read.get(userId);
    const last = previous && index >= this.#messageIndex(chat, previous) ? previous : messageId;
    chat.read.set(userId, last);
    return {
      last_read_message: last,
      remaining_unread: this.#unread(chat, userId),
    };
  }

  #unread(chat: DirectChat, userId: string): number {
    const read = chat.read.get(userId);
    const count = read ? this.#messageIndex(chat, read) : chat.messages.length;
    return chat.messages.slice(0, count).filter((message) => message.sender_id !== userId).length;
  }

  #summary(chat: DirectChat, userId: string) {
    const other = chat.users[0] === userId ? chat.users[1] : chat.users[0];
    const latest = chat.messages[0];
    return {
      chat_id: chat.id,
      chat_type: 0,
      other_user_id: other,
      unread_count: this.#unread(chat, userId),
      my_read_message_id: chat.read.get(userId) ?? null,
      other_read_message_id: chat.read.get(other) ?? null,
      last_message: latest
        ? {
            id: latest.message_id,
            text: latest.text ?? null,
            sender_id: latest.sender_id,
            at: latest.created_at,
          }
        : null,
    };
  }

  #requireChat(chatId: string, userId: string): DirectChat {
    const chat = this.#chats.get(chatId);
    if (!chat?.users.includes(userId)) throw MockDomainError.notFound('Чат не найден');
    return chat;
  }

  #messageIndex(chat: DirectChat, messageId: string): number {
    const index = chat.messages.findIndex(({ message_id }) => message_id === messageId);
    if (index < 0) throw MockDomainError.notFound('Сообщение не найдено');
    return index;
  }
}
