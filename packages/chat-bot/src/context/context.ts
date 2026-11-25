import {
  ChatActionType,
  type ChatEditedMessage,
  type ChatEvents,
  type ChatForwardedMessages,
  type ChatMessage,
  type ChatMessageContent,
  type ChatMessageReactions,
  type ChatReaction,
  type ChatReadResult,
  type ChatSentMessage,
  type ChatSummary,
  type ChatUpdate,
  type FileInput,
  type MessageInput,
  type PublicProfile,
  type RequestOptions,
  type SendChatMessageInput,
} from 'itd-api';

import { addReaction } from './actions/reaction.js';
import { runWithTyping } from './actions/typing.js';
import type { ChatTypingControl, ChatTypingOptions } from './actions/typing.types.js';
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

  /**
   * ID текущего сообщения или сообщения, к которому относится событие.
   * Для пакетного события без текущего сообщения используйте `update.messageIds`.
   */
  get messageId(): string | undefined {
    return this.message?.messageId ?? this.update.messageId;
  }

  /** Идентификатор автора сообщения. Подходит для `itd.users.get()`. */
  get senderId(): string | undefined {
    return this.message?.senderId;
  }

  /** Текст сообщения. */
  get text(): string | null | undefined {
    return this.message?.text;
  }

  /** Загружает профиль автора. Если ID автора или загрузка профиля недоступны, возвращает `undefined`. */
  getSender(
    options?: RequestOptions,
  ): Promise<Awaited<ReturnType<NonNullable<NonNullable<Client['users']>['get']>>> | undefined>;
  async getSender(options?: RequestOptions): Promise<PublicProfile | undefined> {
    const { senderId } = this;
    const users = this.itd.users;
    const get = users?.get;
    if (!senderId || !get) return undefined;
    return withContextSignal(this.signal, options, (request) => get.call(users, senderId, request));
  }

  /** Загружает сводку текущего чата. Для события без чата возвращает `undefined`. */
  getChat(
    options?: RequestOptions,
  ): Promise<Awaited<ReturnType<Client['chats']['get']>> | undefined>;
  async getChat(options?: RequestOptions): Promise<ChatSummary | undefined> {
    const { chatId } = this;
    if (!chatId) return undefined;
    return withContextSignal(this.signal, options, (request) => this.chats.get(chatId, request));
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

  /**
   * Пересылает сообщение из текущего чата.
   *
   * @param targetChatId чат, в который нужно переслать сообщение.
   * @returns результат пересылки со списками `ok` и `failed`.
   */
  forwardTo(targetChatId: string, options?: RequestOptions): Promise<ChatForwardedMessages> {
    const sourceChatId = this.#requireChat();
    const { messageId } = this;
    if (!messageId) throw new Error('У события нет идентификатора сообщения');
    const input = { sourceChatId, messageIds: [messageId] };
    return withContextSignal(this.signal, options, (request) =>
      this.chats.forwardMessages(targetChatId, input, request),
    );
  }

  /**
   * Добавляет реакцию к сообщению события, сохраняя остальные реакции бота.
   * Если реакция уже выбрана, возвращает текущее состояние. `deadline` охватывает все запросы.
   *
   * @param reaction эмодзи или объект реакции, в том числе с ID пользовательского эмодзи.
   * @returns реакции на сообщение и их актуальная версия.
   */
  react(reaction: string | ChatReaction, options?: RequestOptions): Promise<ChatMessageReactions> {
    const chatId = this.#requireChat();
    const { messageId } = this;
    if (!messageId) throw new Error('У события нет идентификатора сообщения');
    return withContextSignal(this.signal, options, (request) =>
      addReaction(this.chats, chatId, messageId, reaction, this.message, request),
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

  /** Принимает запрос на переписку, подтверждённый событием. Возвращает `false`, если запрос не подтверждён. */
  async acceptRequest(options?: RequestOptions): Promise<boolean> {
    if (this.update.isRequest !== true) return false;
    const chatId = this.#requireChat();
    await withContextSignal(this.signal, options, (request) =>
      this.chats.acceptRequest(chatId, request),
    );
    return true;
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

  /**
   * Показывает «печатает», пока выполняется задача. Возвращает её результат.
   * Для событий без чата выполняет задачу без индикатора.
   *
   * @param fn задача с управлением статусом через `start()` и `stop()`.
   * @param options частота обновления и начальная пауза.
   */
  withTyping<T>(
    fn: (typing: ChatTypingControl) => T | Promise<T>,
    options?: ChatTypingOptions,
  ): Promise<T> {
    const send = this.chatId
      ? (signal: AbortSignal) => this.sendAction(ChatActionType.Typing, undefined, { signal })
      : undefined;
    return runWithTyping(fn, send, this.signal, options);
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
