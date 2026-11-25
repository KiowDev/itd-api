import {
  ChatActionType,
  type ChatEditedMessage,
  type ChatEvents,
  type ChatMessage,
  type ChatMessageContent,
  type ChatReadResult,
  type ChatSentMessage,
  type ChatUpdate,
  type FileInput,
  type MessageInput,
  type RequestOptions,
  type SendChatMessageInput,
} from 'itd-api';

import type { ChatBotClient, ChatReplyOptions } from './context.types.js';
import { withContextSignal } from './request-signal.js';

/** Контексты входящих сообщений из `chat_created`. @internal */
export const incomingChatCreatedContexts = new WeakSet<ChatContext>();

/** Контексты, в которых локальный обработчик перехватил ошибку. @internal */
export const failedChatContexts = new WeakSet<ChatContext>();

/** Контекст события. Для пакета сообщений создаётся отдельный контекст на каждое сообщение. */
export class ChatContext<Client extends ChatBotClient = ChatBotClient> {
  /** Клиент, которому принадлежит бот. */
  readonly itd: Client;
  /** Обновление, полученное от SDK. */
  readonly update: ChatUpdate;
  /** Сообщение текущего обработчика. Для событий без сообщения равно `undefined`. */
  readonly message: ChatMessage | undefined;
  /** Сигнал отмены обработки обновления. Методы контекста передают его в запросы автоматически. */
  readonly signal: AbortSignal | undefined;
  /** @internal */
  readonly raw = undefined;
  /** @internal */
  readonly origin = undefined;
  /** Имя команды без префикса, в нижнем регистре. */
  command: string | undefined;
  /** Текст после имени команды. */
  args: string | undefined;
  /** Аргументы команды или результат сопоставления `hears()`. */
  match: string | RegExpMatchArray | undefined;

  /** Создаёт контекст для события и выбранного сообщения. */
  constructor(itd: Client, update: ChatUpdate, message?: ChatMessage, signal?: AbortSignal) {
    this.itd = itd;
    this.update = update;
    this.message = message;
    this.signal = signal;
  }

  /** Канал событий клиента. */
  get stream(): ChatEvents {
    return this.chats.events;
  }

  /** Ресурс чатов переданного клиенту бота. */
  get chats(): Client['chats'] {
    return this.itd.chats;
  }

  /** Идентификатор чата события. */
  get chatId(): string | undefined {
    return this.update.chatId;
  }

  /** Идентификатор автора сообщения. Подходит для `itd.users.get()`. */
  get senderId(): string | undefined {
    return this.message?.senderId;
  }

  /** Текст сообщения. */
  get text(): string | null | undefined {
    return this.message?.text;
  }

  /** Отправляет сообщение в текущий чат. Принимает объект, билдер или функцию сборки. */
  send(input: MessageInput, options?: RequestOptions): Promise<ChatSentMessage> {
    const chatId = this.#requireChat();
    return withContextSignal(this.signal, options, (request) =>
      this.chats.sendMessage(chatId, input, request),
    );
  }

  /** Отправляет текст в текущий чат. */
  reply(
    text: string,
    input?: ChatReplyOptions,
    options?: RequestOptions,
  ): Promise<ChatSentMessage> {
    return this.send({ ...input, text }, options);
  }

  /** Отправляет текстовый ответ на `ctx.message` в текущий чат. */
  replyTo(
    text: string,
    input?: ChatReplyOptions,
    options?: RequestOptions,
  ): Promise<ChatSentMessage> {
    return this.send({ ...input, text, replyToId: this.#requireMessage() }, options);
  }

  /**
   * Загружает файлы и отправляет сообщение в текущий чат. `deadline` охватывает загрузку и отправку.
   *
   * @param input текст и другие поля сообщения. Готовые вложения сохраняются.
   * @param files файлы, которые нужно загрузить перед отправкой.
   */
  async sendWithAttachments(
    input: SendChatMessageInput,
    files: readonly FileInput[],
    options?: RequestOptions,
  ): Promise<ChatSentMessage> {
    return this.send({ ...input, files: [...files, ...(input.files ?? [])] }, options);
  }

  /** Редактирует текущее сообщение. */
  edit(input: ChatMessageContent, options?: RequestOptions): Promise<ChatEditedMessage> {
    const chatId = this.#requireChat();
    const messageId = this.#requireMessage();
    return withContextSignal(this.signal, options, (request) =>
      this.chats.editMessage(chatId, messageId, input, request),
    );
  }

  /** Отмечает чат прочитанным до текущего сообщения включительно. */
  markRead(options?: RequestOptions): Promise<ChatReadResult> {
    const chatId = this.#requireChat();
    const messageId = this.#requireMessage();
    return withContextSignal(this.signal, options, (request) =>
      this.chats.markRead(chatId, messageId, request),
    );
  }

  /**
   * Показывает собеседнику действие бота.
   *
   * @param type действие. По умолчанию `ChatActionType.Typing`.
   * @param progress доля загруженного файла от 0 до 1 для действий загрузки.
   */
  sendAction(
    type: ChatActionType = ChatActionType.Typing,
    progress?: number,
    options?: RequestOptions,
  ): Promise<void> {
    const chatId = this.#requireChat();
    return withContextSignal(this.signal, options, (request) =>
      this.chats.sendAction(chatId, type, progress, request),
    );
  }

  #requireChat(): string {
    if (!this.chatId) throw new Error('У события нет идентификатора чата');
    return this.chatId;
  }

  #requireMessage(): string {
    if (!this.message) throw new Error('У события нет сообщения');
    return this.message.messageId;
  }
}
