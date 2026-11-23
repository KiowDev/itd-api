import {
  ChatActionType,
  type ChatEditedMessage,
  type ChatEvents,
  type ChatMessage,
  type ChatMessageContent,
  type ChatReadResult,
  type ChatSentMessage,
  type ChatsApi,
  type ChatUpdate,
  type FileInput,
  type ItdClient,
  type MessageInput,
  type RequestOptions,
  type SendChatMessageInput,
} from 'itd-api';

/** Клиент с ресурсом и каналом событий чатов. */
export interface ChatBotClient extends Pick<ItdClient, 'install'> {
  /** Позволяет отличить сообщения бота от сообщений собеседника. */
  readonly getUserId?: ItdClient['getUserId'];
  /** Загружает текущий профиль, когда ID нельзя прочитать из токена. */
  readonly users?: Pick<ItdClient['users'], 'me'>;
  readonly chats: Pick<
    ChatsApi,
    'events' | 'list' | 'sendMessage' | 'editMessage' | 'markRead' | 'sendAction' | 'uploadFile'
  >;
}

/** Дополнительные поля текстового ответа. */
export type ChatReplyOptions = Omit<SendChatMessageInput, 'text' | 'replyToId'>;

/** Контекст события. Для пакета сообщений создаётся отдельный контекст на каждое сообщение. */
export class ChatContext<Client extends ChatBotClient = ChatBotClient> {
  /** Клиент, которому принадлежит бот. */
  readonly itd: Client;
  /** Обновление, полученное от SDK. */
  readonly update: ChatUpdate;
  /** Сообщение, выбранное из обновления. */
  readonly message: ChatMessage | undefined;
  /** Сигнал для прямых вызовов SDK, связанных с обработкой сообщения. */
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
    return this.chats.sendMessage(this.#requireChat(), input, this.#requestOptions(options));
  }

  /** Отправляет текст в текущий чат. */
  reply(
    text: string,
    input?: ChatReplyOptions,
    options?: RequestOptions,
  ): Promise<ChatSentMessage> {
    return this.send({ ...input, text }, options);
  }

  /** Цитирует текущее сообщение в ответе. */
  replyTo(
    text: string,
    input?: ChatReplyOptions,
    options?: RequestOptions,
  ): Promise<ChatSentMessage> {
    return this.send({ ...input, text, replyToId: this.#requireMessage() }, options);
  }

  /** Загружает файлы и отправляет сообщение в текущий чат. `deadline` охватывает всю отправку. */
  async sendWithAttachments(
    input: SendChatMessageInput,
    files: readonly FileInput[],
    options?: RequestOptions,
  ): Promise<ChatSentMessage> {
    return this.send({ ...input, files: [...files, ...(input.files ?? [])] }, options);
  }

  /** Редактирует текущее сообщение. */
  edit(input: ChatMessageContent, options?: RequestOptions): Promise<ChatEditedMessage> {
    return this.chats.editMessage(
      this.#requireChat(),
      this.#requireMessage(),
      input,
      this.#requestOptions(options),
    );
  }

  /** Отмечает чат прочитанным до текущего сообщения включительно. */
  markRead(options?: RequestOptions): Promise<ChatReadResult> {
    return this.chats.markRead(
      this.#requireChat(),
      this.#requireMessage(),
      this.#requestOptions(options),
    );
  }

  /** Показывает действие бота в текущем чате. По умолчанию показывает «печатает…». */
  sendAction(
    type: ChatActionType = ChatActionType.Typing,
    progress?: number,
    options?: RequestOptions,
  ): Promise<void> {
    return this.chats.sendAction(
      this.#requireChat(),
      type,
      progress,
      this.#requestOptions(options),
    );
  }

  /** Объединяет отмену запроса с отменой обработки сообщения. */
  #requestOptions(options?: RequestOptions): RequestOptions | undefined {
    if (!this.signal) return options;
    this.signal.throwIfAborted();
    return {
      ...options,
      signal: options?.signal ? AbortSignal.any([this.signal, options.signal]) : this.signal,
    };
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
