import type { FileInput } from '../core/attachments/contracts.js';
import type { HttpClient } from '../core/execution/http.js';
import { voidResult } from '../core/operation.js';
import type { PaginationOptions, RequestOptions } from '../core/options.js';
import { encodePathSegment } from '../core/url.js';
import {
  normalizeChatChange,
  normalizeChatDeleted,
  normalizeChatDirect,
  normalizeChatEdited,
  normalizeChatFirstMessage,
  normalizeChatForwarded,
  normalizeChatHistory,
  normalizeChatList,
  normalizeChatMedia,
  normalizeChatReactionCatalog,
  normalizeChatReactions,
  normalizeChatRead,
  normalizeChatSent,
  normalizeChatSummary,
  normalizeChatUnread,
  normalizeChatUpdates,
  writeChatEntity,
  writeChatReaction,
} from '../domain/content.js';
import { defineBuiltInOperation } from '../domain/operations.js';
import type {
  ChatActionType,
  ChatChange,
  ChatDeletedMessages,
  ChatDirectResult,
  ChatEditedMessage,
  ChatFileLink,
  ChatFirstMessage,
  ChatForwardedMessages,
  ChatHistoryPage,
  ChatListPage,
  ChatMediaCategory,
  ChatMediaPage,
  ChatMessage,
  ChatMessageReactions,
  ChatPresence,
  ChatReaction,
  ChatReactionCatalog,
  ChatReadResult,
  ChatSentMessage,
  ChatSummary,
  ChatTextEntity,
  ChatUnreadState,
  ChatUpdatesPage,
  ChatUploadedFile,
  ChatUploadOptions,
} from '../models/chats.js';
import { type ChatUploadHost, uploadChatFile } from '../uploads/chat.js';
import { BaseResource } from './base.js';
import { PaginationMode, type Paginator } from './pagination.js';

const MESSENGER_PATH = '/api/v1/messenger';
const CHATS_PATH = `${MESSENGER_PATH}/chats`;
const DEFAULT_AROUND_LIMIT = 40;
const HISTORY_PAGE_LIMIT = 50;

const LIST = defineBuiltInOperation('chats.list', normalizeChatList);
const GET = defineBuiltInOperation('chats.get', normalizeChatSummary);
const UNREAD = defineBuiltInOperation('chats.unread', normalizeChatUnread);
const MESSAGES = defineBuiltInOperation('chats.messages', normalizeChatHistory);
const MESSAGES_AROUND = defineBuiltInOperation('chats.messagesAround', normalizeChatHistory);
const MEDIA = defineBuiltInOperation('chats.media', normalizeChatMedia);
const FILE_LINKS = defineBuiltInOperation<ChatFileLink[]>(
  'chats.fileLinks',
  (body) => (body as { links: ChatFileLink[] }).links,
);
const PRESENCE = defineBuiltInOperation<ChatPresence>('chats.presence');
const PRESENCE_MANY = defineBuiltInOperation<Record<string, boolean>>(
  'chats.presenceMany',
  (body) => (body as { presence: Record<string, boolean> }).presence,
);
const REACTION_CATALOG = defineBuiltInOperation(
  'chats.reactionCatalog',
  normalizeChatReactionCatalog,
);
const REACTIONS = defineBuiltInOperation('chats.reactions', normalizeChatReactions);
const HEARD_MESSAGES = defineBuiltInOperation<string[]>(
  'chats.heardMessages',
  (body) => (body as { message_ids: string[] }).message_ids,
);
const UPDATES = defineBuiltInOperation('chats.updates', normalizeChatUpdates);
const CREATE_DIRECT = defineBuiltInOperation('chats.createDirect', normalizeChatDirect);
const SEND_MESSAGE = defineBuiltInOperation('chats.sendMessage', normalizeChatSent);
const SEND_MESSAGE_TO_USER = defineBuiltInOperation(
  'chats.sendMessageToUser',
  normalizeChatFirstMessage,
);
const EDIT_MESSAGE = defineBuiltInOperation('chats.editMessage', normalizeChatEdited);
const FORWARD_MESSAGES = defineBuiltInOperation('chats.forwardMessages', normalizeChatForwarded);
const DELETE_MESSAGES_FOR_ME = defineBuiltInOperation(
  'chats.deleteMessagesForMe',
  normalizeChatDeleted,
);
const DELETE_MESSAGES_FOR_ALL = defineBuiltInOperation(
  'chats.deleteMessagesForAll',
  normalizeChatDeleted,
);
const SET_PINNED = defineBuiltInOperation('chats.setPinned', voidResult);
const SET_MUTED = defineBuiltInOperation('chats.setMuted', voidResult);
const SET_UNREAD = defineBuiltInOperation('chats.setUnread', voidResult);
const MARK_READ = defineBuiltInOperation('chats.markRead', normalizeChatRead);
const ACCEPT_REQUEST = defineBuiltInOperation('chats.acceptRequest', voidResult);
const MARK_HEARD = defineBuiltInOperation('chats.markHeard', voidResult);
const SEND_ACTION = defineBuiltInOperation('chats.sendAction', voidResult);
const CLEAR_HISTORY = defineBuiltInOperation('chats.clearHistory', normalizeChatChange);
const CLEAR_HISTORY_FOR_ALL = defineBuiltInOperation(
  'chats.clearHistoryForAll',
  normalizeChatChange,
);
const DELETE = defineBuiltInOperation('chats.delete', normalizeChatChange);
const SET_REACTIONS = defineBuiltInOperation('chats.setReactions', normalizeChatReactions);

/** Курсор и размер страницы. */
export interface ChatListParams {
  before?: string | undefined;
  limit?: number;
}

/** Текст, форматирование и ID файлов, уже загруженных в мессенджер. */
export interface ChatMessageContent {
  text: string;
  attachmentIds?: readonly string[];
  entities?: readonly ChatTextEntity[];
}

/** Параметры отправки сообщения. */
export interface SendChatMessageInput extends ChatMessageContent {
  replyToId?: string | null;
  /** UUIDv7, по которому сервер распознаёт повторную отправку. */
  clientMessageId?: string;
}

/** Реакции текущего пользователя, которые заменят его прежний выбор. */
export interface SetChatReactionsInput {
  reactions: readonly ChatReaction[];
  /** Версия, полученная из состояния реакций сообщения. */
  expectedVersion: string;
  /** UUID операции замены реакций. */
  operationId: string;
}

/** Сообщения из исходного чата, которые будут пересланы в целевой чат. */
export interface ForwardChatMessagesInput {
  sourceChatId: string;
  messageIds: readonly string[];
  /** UUIDv7 для отправки каждого исходного сообщения, по ID сообщения. */
  clientMessageIds?: Readonly<Record<string, string>>;
}

function chatPath(chatId: string): string {
  return `${CHATS_PATH}/${encodePathSegment(chatId, 'идентификатор чата')}`;
}

function messageSegment(messageId: string): string {
  return encodePathSegment(messageId, 'идентификатор сообщения');
}

/** Чаты, сообщения, вложения и журнал изменений. Доступен как `itd.chats`. */
export class ChatsResource extends BaseResource {
  readonly #host: ChatUploadHost;

  /** @internal */
  constructor(http: HttpClient, host: ChatUploadHost) {
    super(http);
    this.#host = host;
  }

  /**
   * Возвращает страницу чатов текущего пользователя.
   *
   * @example
   * ```ts
   * const page = await itd.chats.list({ limit: 20 });
   * if (page.nextBefore) await itd.chats.list({ before: page.nextBefore, limit: 20 });
   * ```
   */
  list(params: ChatListParams = {}, options: RequestOptions = {}): Promise<ChatListPage> {
    return this.http.execute(LIST, {
      path: CHATS_PATH,
      query: { before: params.before, limit: params.limit, manual_unread: 1 },
      ...options,
    });
  }

  /**
   * Перебирает чаты текущего пользователя по курсору списка.
   *
   * @example
   * ```ts
   * for await (const chat of itd.chats.iterate({ limit: 20 })) {
   *   console.log(chat.chatId, chat.unreadCount);
   * }
   * ```
   */
  iterate(params: ChatListParams = {}, options: PaginationOptions = {}): Paginator<ChatSummary> {
    return this.paginate(
      PaginationMode.Cursor,
      async ({ cursor }) => {
        const page = await this.list({ ...params, before: cursor }, options);
        return {
          items: page.chats,
          hasMore: Boolean(page.nextBefore),
          nextCursor: page.nextBefore,
          raw: page,
        };
      },
      { ...options, start: { cursor: params.before } },
    );
  }

  /** Возвращает сводку чата по его идентификатору. */
  get(chatId: string, options: RequestOptions = {}): Promise<ChatSummary> {
    return this.http.execute(GET, {
      path: chatPath(chatId),
      query: { manual_unread: 1 },
      ...options,
    });
  }

  /** Возвращает число непрочитанных и число чатов с непрочитанным. */
  unread(options: RequestOptions = {}): Promise<ChatUnreadState> {
    return this.http.execute(UNREAD, {
      path: `${CHATS_PATH}/unread`,
      query: { manual_unread: 1 },
      ...options,
    });
  }

  /**
   * Загружает историю, начиная с последних сообщений.
   *
   * Для следующей страницы передайте ID последнего сообщения страницы в `before`.
   * Для последовательного чтения используйте {@link iterateMessages}.
   */
  messages(
    chatId: string,
    params: ChatListParams = {},
    options: RequestOptions = {},
  ): Promise<ChatHistoryPage> {
    return this.http.execute(MESSAGES, {
      path: `${chatPath(chatId)}/messages`,
      query: { before: params.before, limit: params.limit },
      ...options,
    });
  }

  /**
   * Перебирает сообщения от новых к старым, подставляя ID последнего сообщения как курсор.
   *
   * @example
   * ```ts
   * for await (const message of itd.chats.iterateMessages(chatId)) {
   *   console.log(message.text);
   * }
   * ```
   */
  iterateMessages(
    chatId: string,
    params: ChatListParams = {},
    options: PaginationOptions = {},
  ): Paginator<ChatMessage> {
    const limit = params.limit ?? HISTORY_PAGE_LIMIT;
    return this.paginate(
      PaginationMode.Cursor,
      async ({ cursor }) => {
        const page = await this.messages(chatId, { limit, before: cursor }, options);
        const nextCursor = page.messages.at(-1)?.messageId;
        return {
          items: page.messages,
          hasMore: nextCursor !== undefined && (page.hasOlder ?? page.messages.length >= limit),
          nextCursor,
          raw: page,
        };
      },
      { ...options, start: { cursor: params.before } },
    );
  }

  /** Загружает часть истории вокруг сообщения. По умолчанию запрашивает до 40 сообщений. */
  messagesAround(
    chatId: string,
    messageId: string,
    limit = DEFAULT_AROUND_LIMIT,
    options: RequestOptions = {},
  ): Promise<ChatHistoryPage> {
    return this.http.execute(MESSAGES_AROUND, {
      path: `${chatPath(chatId)}/messages/around/${messageSegment(messageId)}`,
      query: { limit },
      ...options,
    });
  }

  /** Загружает вложения выбранной категории. Для следующей страницы передайте `nextBefore`. */
  media(
    chatId: string,
    category: ChatMediaCategory,
    params: ChatListParams = {},
    options: RequestOptions = {},
  ): Promise<ChatMediaPage> {
    return this.http.execute(MEDIA, {
      path: `${chatPath(chatId)}/media`,
      query: { category, before: params.before, limit: params.limit },
      ...options,
    });
  }

  /**
   * Загружает файл в мессенджер. Потоковый источник должен сообщить размер заранее.
   * `deadline` охватывает чтение файла, отправку частей и завершение загрузки.
   *
   * @example
   * ```ts
   * const { fileId } = await itd.chats.uploadFile(file);
   * await itd.chats.sendMessage(chatId, { text: '', attachmentIds: [fileId] });
   * ```
   */
  uploadFile(
    file: FileInput,
    uploadOptions: ChatUploadOptions = {},
    options: RequestOptions = {},
  ): Promise<ChatUploadedFile> {
    return uploadChatFile(this.http, this.#host, file, uploadOptions, options);
  }

  /** Получает временные ссылки на файлы чата. Срок действия каждой ссылки указан в `expiresIn`. */
  fileLinks(
    chatId: string,
    fileIds: readonly string[],
    options: RequestOptions = {},
  ): Promise<ChatFileLink[]> {
    return this.http.execute(FILE_LINKS, {
      path: `${chatPath(chatId)}/file-links`,
      body: { file_ids: fileIds },
      ...options,
    });
  }

  /** Возвращает статус присутствия одного пользователя. */
  presence(userId: string, options: RequestOptions = {}): Promise<ChatPresence> {
    return this.http.execute(PRESENCE, {
      path: `${MESSENGER_PATH}/presence/${encodePathSegment(userId, 'идентификатор пользователя')}`,
      ...options,
    });
  }

  /** Возвращает карту `ID → онлайн` одним запросом. */
  presenceMany(
    userIds: readonly string[],
    options: RequestOptions = {},
  ): Promise<Record<string, boolean>> {
    return this.http.execute(PRESENCE_MANY, {
      path: `${MESSENGER_PATH}/presence`,
      body: { user_ids: userIds },
      ...options,
    });
  }

  /** Загружает список доступных реакций. */
  reactionCatalog(options: RequestOptions = {}): Promise<ChatReactionCatalog> {
    return this.http.execute(REACTION_CATALOG, {
      path: `${MESSENGER_PATH}/reactions/available`,
      ...options,
    });
  }

  /** Возвращает суммарные реакции на сообщение и версию их состояния. */
  reactions(
    chatId: string,
    messageId: string,
    options: RequestOptions = {},
  ): Promise<ChatMessageReactions> {
    return this.http.execute(REACTIONS, {
      path: `${chatPath(chatId)}/messages/${messageSegment(messageId)}/reactions`,
      ...options,
    });
  }

  /** Возвращает ID прослушанных сообщений из переданного списка. */
  heardMessages(
    chatId: string,
    messageIds: readonly string[],
    options: RequestOptions = {},
  ): Promise<string[]> {
    return this.http.execute(HEARD_MESSAGES, {
      path: `${chatPath(chatId)}/heard`,
      body: { message_ids: messageIds },
      ...options,
    });
  }

  /**
   * Загружает изменения после `eventSeq` из списка чатов или `nextEventSeq` предыдущей страницы.
   * Передайте возвращённый `nextEventSeq` в следующий вызов. При `resetRequired` перечитайте список чатов.
   */
  updates(since: number, limit?: number, options: RequestOptions = {}): Promise<ChatUpdatesPage> {
    return this.http.execute(UPDATES, {
      path: `${MESSENGER_PATH}/updates`,
      query: { since, limit, capabilities: 'chat_settings', manual_unread: 1 },
      ...options,
    });
  }

  /** Возвращает ID личного чата по ID собеседника. `created` показывает, создан ли новый чат. */
  createDirect(userId: string, options: RequestOptions = {}): Promise<ChatDirectResult> {
    return this.http.execute(CREATE_DIRECT, {
      path: `${CHATS_PATH}/dm`,
      body: { target_user_id: userId },
      ...options,
    });
  }

  /**
   * Отправляет сообщение в существующий чат.
   *
   * @example
   * ```ts
   * const sent = await itd.chats.sendMessage(chatId, { text: 'Привет!' });
   * console.log(sent.messageId);
   * ```
   */
  sendMessage(
    chatId: string,
    input: SendChatMessageInput,
    options: RequestOptions = {},
  ): Promise<ChatSentMessage> {
    return this.http.execute(SEND_MESSAGE, {
      path: `${chatPath(chatId)}/messages`,
      body: {
        text: input.text,
        reply_to_id: input.replyToId ?? null,
        attachments: input.attachmentIds?.length ? input.attachmentIds : undefined,
        entities: input.entities?.length ? input.entities.map(writeChatEntity) : undefined,
        client_message_id: input.clientMessageId,
      },
      ...options,
    });
  }

  /** Отправляет сообщение по ID собеседника. Если диалога ещё нет, сервер создаёт его. */
  sendMessageToUser(
    userId: string,
    input: Omit<SendChatMessageInput, 'replyToId'>,
    options: RequestOptions = {},
  ): Promise<ChatFirstMessage> {
    return this.http.execute(SEND_MESSAGE_TO_USER, {
      path: `${MESSENGER_PATH}/users/${encodePathSegment(userId, 'идентификатор пользователя')}/messages`,
      body: {
        text: input.text,
        attachments: input.attachmentIds?.length ? input.attachmentIds : undefined,
        entities: input.entities?.length ? input.entities.map(writeChatEntity) : undefined,
        client_message_id: input.clientMessageId,
      },
      ...options,
    });
  }

  /** Меняет содержимое сообщения. Пустой массив `entities` сбрасывает форматирование. */
  editMessage(
    chatId: string,
    messageId: string,
    input: ChatMessageContent,
    options: RequestOptions = {},
  ): Promise<ChatEditedMessage> {
    return this.http.execute(EDIT_MESSAGE, {
      path: `${chatPath(chatId)}/messages/${messageSegment(messageId)}`,
      body: {
        text: input.text,
        attachments: input.attachmentIds?.length ? input.attachmentIds : undefined,
        entities: input.entities?.map(writeChatEntity),
      },
      ...options,
    });
  }

  /** Пересылает сообщения из другого чата. Результат содержит успешные и отклонённые элементы. */
  forwardMessages(
    chatId: string,
    input: ForwardChatMessagesInput,
    options: RequestOptions = {},
  ): Promise<ChatForwardedMessages> {
    return this.http.execute(FORWARD_MESSAGES, {
      path: `${chatPath(chatId)}/messages/forward`,
      body: {
        source_chat_id: input.sourceChatId,
        message_ids: input.messageIds,
        client_message_ids: input.clientMessageIds,
      },
      ...options,
    });
  }

  /** Удаляет сообщения из истории текущего пользователя. */
  deleteMessagesForMe(
    chatId: string,
    messageIds: readonly string[],
    options: RequestOptions = {},
  ): Promise<ChatDeletedMessages> {
    return this.http.execute(DELETE_MESSAGES_FOR_ME, {
      path: `${chatPath(chatId)}/messages/delete-for-me`,
      body: { message_ids: messageIds },
      ...options,
    });
  }

  /** Удаляет сообщения из истории всех участников. */
  deleteMessagesForAll(
    chatId: string,
    messageIds: readonly string[],
    options: RequestOptions = {},
  ): Promise<ChatDeletedMessages> {
    return this.http.execute(DELETE_MESSAGES_FOR_ALL, {
      path: `${chatPath(chatId)}/messages/delete-for-all`,
      body: { message_ids: messageIds },
      ...options,
    });
  }

  /** Закрепляет или открепляет чат в списке. */
  setPinned(chatId: string, pinned: boolean, options: RequestOptions = {}): Promise<void> {
    return this.voidOperation(SET_PINNED, {
      path: `${chatPath(chatId)}/pin`,
      body: { is_pinned: pinned },
      ...options,
    });
  }

  /** Отключает или включает уведомления чата. */
  setMuted(chatId: string, muted: boolean, options: RequestOptions = {}): Promise<void> {
    return this.voidOperation(SET_MUTED, {
      path: `${chatPath(chatId)}/mute`,
      body: { is_muted: muted },
      ...options,
    });
  }

  /** Выставляет или снимает ручную отметку непрочитанного. */
  setUnread(chatId: string, unread: boolean, options: RequestOptions = {}): Promise<void> {
    return this.voidOperation(SET_UNREAD, {
      path: `${chatPath(chatId)}/unread`,
      body: { unread },
      ...options,
    });
  }

  /** Отмечает историю прочитанной до указанного сообщения включительно. */
  markRead(
    chatId: string,
    lastReadMessage: string,
    options: RequestOptions = {},
  ): Promise<ChatReadResult> {
    return this.http.execute(MARK_READ, {
      path: `${chatPath(chatId)}/read`,
      body: { last_read_message: lastReadMessage },
      ...options,
    });
  }

  /** Принимает запрос на переписку. */
  acceptRequest(chatId: string, options: RequestOptions = {}): Promise<void> {
    return this.voidOperation(ACCEPT_REQUEST, { path: `${chatPath(chatId)}/accept`, ...options });
  }

  /** Отмечает голосовое сообщение прослушанным. */
  markHeard(chatId: string, messageId: string, options: RequestOptions = {}): Promise<void> {
    return this.voidOperation(MARK_HEARD, {
      path: `${chatPath(chatId)}/messages/${messageSegment(messageId)}/heard`,
      ...options,
    });
  }

  /** Показывает собеседнику действие. Для загрузки `progress` задаётся долей от 0 до 1. */
  sendAction(
    chatId: string,
    type: ChatActionType,
    progress?: number,
    options: RequestOptions = {},
  ): Promise<void> {
    const uploadProgress =
      progress !== undefined && type.startsWith('upload_')
        ? Math.min(1, Math.max(0, progress))
        : undefined;
    return this.voidOperation(SEND_ACTION, {
      path: `${chatPath(chatId)}/action`,
      body: { type, progress: uploadProgress },
      ...options,
    });
  }

  /** Очищает историю у текущего пользователя или у всех участников. */
  clearHistory(
    chatId: string,
    forEveryone = false,
    options: RequestOptions = {},
  ): Promise<ChatChange | undefined> {
    return this.http.execute(forEveryone ? CLEAR_HISTORY_FOR_ALL : CLEAR_HISTORY, {
      path: `${chatPath(chatId)}/${forEveryone ? 'clear-history-all' : 'clear-history'}`,
      ...options,
    });
  }

  /** Удаляет чат у текущего пользователя или у всех участников. */
  delete(
    chatId: string,
    forEveryone = false,
    options: RequestOptions = {},
  ): Promise<ChatChange | undefined> {
    return this.http.execute(DELETE, {
      path: `${chatPath(chatId)}/delete`,
      body: { for_everyone: forEveryone },
      ...options,
    });
  }

  /**
   * Заменяет реакции текущего пользователя. Пустой список снимает его реакции.
   *
   * В `expectedVersion` передайте `reactionVersion` из {@link reactions}. При конфликте перечитайте
   * состояние перед повторной записью.
   */
  setReactions(
    chatId: string,
    messageId: string,
    input: SetChatReactionsInput,
    options: RequestOptions = {},
  ): Promise<ChatMessageReactions> {
    return this.http.execute(SET_REACTIONS, {
      path: `${chatPath(chatId)}/messages/${messageSegment(messageId)}/reactions`,
      body: {
        reactions: input.reactions.map(writeChatReaction),
        expected_version: input.expectedVersion,
        operation_id: input.operationId,
      },
      ...options,
    });
  }
}
