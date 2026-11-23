import type { Loose } from '../types/enums.js';
import type { IsoDate } from './common.js';

/** Краткое представление последнего сообщения в списке чатов. */
export interface ChatPreview {
  id: string;
  text?: string | null;
  senderId?: string | null;
  at?: IsoDate | null;
  attachmentKind?: string | null;
  attachmentFilename?: string | null;
  attachmentCount?: number | null;
}

/** Сводка чата. Тип `0` обозначает личный диалог. */
export interface ChatSummary {
  chatId: string;
  chatType: number;
  title?: string | null;
  avatar?: string | null;
  otherUserId?: string | null;
  otherUserDeleted?: boolean;
  otherReadMessageId?: string | null;
  myReadMessageId?: string | null;
  unreadCount: number;
  markedUnread?: boolean;
  isRequest?: boolean;
  isPinned?: boolean;
  isMuted?: boolean;
  lastMessage?: ChatPreview | null;
}

/** Страница чатов. `nextBefore` передаётся в следующий вызов списка. */
export interface ChatListPage {
  chats: ChatSummary[];
  nextBefore?: string | null;
  eventSeq?: number | null;
}

/** Счётчики непрочитанного и номер последнего события на момент подсчёта. */
export interface ChatUnreadState {
  total: number;
  chatsWithUnread: number;
  eventSeq: number;
}

/** Результат открытия личного диалога. */
export interface ChatDirectResult {
  chatId: string;
  created: boolean;
}

/** Файл, прикреплённый к сообщению. */
export interface ChatAttachment {
  fileId: string;
  url: string;
  filename?: string | null;
  mime?: string | null;
  sizePlain?: number | null;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
  expiresIn?: number | null;
  thumbUrl?: string | null;
  thumbWidth?: number | null;
  thumbHeight?: number | null;
  thumbhash?: string | null;
  waveform?: string | null;
}

/** Временная ссылка на вложение чата. */
export interface ChatFileLink {
  fileId: string;
  url: string;
  expiresIn: number;
  thumbUrl?: string | null;
}

/** Результат загрузки. `fileId` передаётся при отправке сообщения. */
export interface ChatUploadedFile {
  fileId: string;
  sizeCipher: number;
}

/** Параметры файла и метаданные вложения мессенджера. */
export interface ChatUploadOptions {
  filename?: string;
  contentType?: string;
  width?: number;
  height?: number;
  /** Длительность аудио или видео, мс. */
  durationMs?: number;
  /** Закодированная форма волны голосового сообщения. */
  waveform?: string;
  /** ThumbHash в Base64. */
  thumbhash?: string;
  /** Готовое JPEG-превью в Base64 и его размеры в пикселях. */
  thumb?: { bytes: string; width: number; height: number };
  /** Вызывается после отправки каждой части. Оба значения в байтах. */
  onProgress?: (uploaded: number, total: number) => void;
}

/** Форматирование или ссылка в сообщении. Смещение и длина заданы в единицах UTF-16. */
export interface ChatTextEntity {
  type: string;
  offset?: number;
  length?: number;
  url?: string;
  postId?: string;
  stickerId?: string;
}

/** Тип реакции на сообщение. */
export const ChatReactionType = Object.freeze({
  Emoji: 'emoji',
  Custom: 'custom',
} as const);

/** Реакция Unicode или реакция с изображением. */
export type ChatReaction =
  | { type: (typeof ChatReactionType)['Emoji']; emoji: string }
  | { type: (typeof ChatReactionType)['Custom']; fileId: string };

/** Число реакций одного вида и признак выбора текущим пользователем. */
export interface ChatReactionCount {
  reaction: ChatReaction;
  count: number;
  chosen?: boolean;
}

/** Сводка сообщения, на которое дан ответ. */
export interface ChatReply {
  messageId: string;
  senderId: string;
  senderName?: string | null;
  text?: string | null;
}

/** Сообщение из истории чата. */
export interface ChatMessage {
  messageId: string;
  senderId: string;
  createdAt: IsoDate;
  text?: string | null;
  attachments?: ChatAttachment[];
  reactions?: ChatReactionCount[];
  reactionVersion?: string | null;
  replyTo?: ChatReply | null;
  entities?: ChatTextEntity[] | null;
  isDeleted?: boolean;
  unavailable?: boolean;
  forwardedFromChatId?: string | null;
  forwardedFromMessageId?: string | null;
  forwardedFromSenderId?: string | null;
  forwardedFromName?: string | null;
  editedAt?: IsoDate | null;
  clientMessageId?: string;
}

/** Последнее прочитанное сообщение участника. */
export interface ChatReadCursor {
  messageId: string;
  timestamp?: IsoDate | null;
}

/** Сообщения и отметки о прочтении для каждого участника. */
export interface ChatHistoryPage {
  messages: ChatMessage[];
  readCursors?: Record<string, ChatReadCursor>;
  myLastRead?: ChatReadCursor | null;
  hasOlder?: boolean;
  hasNewer?: boolean;
  eventSeq?: number | null;
}

/** Категория вложений для выборки из истории чата. */
export const ChatMediaCategory = Object.freeze({
  Media: 0,
  Files: 1,
  Music: 2,
  Voice: 3,
} as const);
export type ChatMediaCategory = (typeof ChatMediaCategory)[keyof typeof ChatMediaCategory];

/** Вложение и идентификатор сообщения, из которого оно получено. */
export interface ChatMediaItem {
  messageId: string;
  senderId: string;
  createdAt: IsoDate;
  file: ChatAttachment;
}

/** Страница вложений. */
export interface ChatMediaPage {
  items: ChatMediaItem[];
  nextBefore?: string | null;
}

/** Статус присутствия пользователя в мессенджере. */
export interface ChatPresence {
  online: boolean;
}

/** Доступные реакции. */
export interface ChatReactionCatalog {
  hash: string;
  userMax: number;
  reactions: (ChatReaction & { title?: string })[];
}

/** Текущие реакции на сообщение и версия для следующей записи. */
export interface ChatMessageReactions {
  messageId: string;
  reactions: ChatReactionCount[];
  reactionVersion: string;
}

/** Позиция изменения в журнале мессенджера. */
export interface ChatChange {
  eventSeq?: number;
  eventSeqCount?: number;
}

/** Результат отправки. При повторном клиентском ID сервер может вернуть прежний результат. */
export interface ChatSentMessage extends ChatChange {
  messageId: string;
  clientMessageId?: string;
  createdAt?: IsoDate;
  attachments?: ChatAttachment[];
  replayed?: boolean;
}

/** Результат первого сообщения пользователю с идентификатором открытого диалога. */
export interface ChatFirstMessage extends ChatSentMessage {
  chatId: string;
}

/** Результат редактирования сообщения. */
export interface ChatEditedMessage extends ChatChange {
  messageId: string;
  editedAt?: IsoDate | null;
  attachments?: ChatAttachment[];
  entities?: ChatTextEntity[] | null;
}

/** Результат отметки истории о прочтении. */
export interface ChatReadResult extends ChatChange {
  lastReadMessage?: string;
  remainingUnread?: number;
}

/** Результат пакетного удаления сообщений. */
export interface ChatDeletedMessages extends ChatChange {
  ok: string[];
  failed?: unknown[];
}

/** Результат пересылки. Частичный успех отражён в отдельных списках. */
export interface ChatForwardedMessages extends ChatChange {
  ok: { sourceMessageId: string }[];
  failed: unknown[];
}

/** Действие, отображаемое собеседнику. */
export const ChatActionType = Object.freeze({
  Typing: 'typing',
  RecordVoice: 'record_voice',
  RecordVideo: 'record_video',
  UploadPhoto: 'upload_photo',
  UploadVideo: 'upload_video',
  UploadVoice: 'upload_voice',
  UploadDocument: 'upload_document',
} as const);
export type ChatActionType = (typeof ChatActionType)[keyof typeof ChatActionType];

/** Известные типы обновлений мессенджера. */
export const ChatUpdateType = Object.freeze({
  NewMessage: 'new_message',
  NewMessages: 'new_messages',
  OwnMessages: 'own_messages',
  MessageEdited: 'message_edited',
  MessageDeleted: 'message_deleted',
  MessagesDeleted: 'messages_deleted',
  MessagesRead: 'messages_read',
  Presence: 'presence',
  /** Действие собеседника. Конкретное действие передаётся в `action`. */
  Typing: 'typing',
  ChatCreated: 'chat_created',
  ChatDeleted: 'chat_deleted',
  ChatSettings: 'chat_settings',
  HistoryCleared: 'history_cleared',
  MessageReactions: 'message_reactions',
} as const);
export type ChatUpdateType = Loose<(typeof ChatUpdateType)[keyof typeof ChatUpdateType]>;

/** Событие журнала или канала чатов. Состав данных зависит от его типа. */
export interface ChatUpdate {
  type: ChatUpdateType;
  eventSeq?: number | null;
  eventSeqCount?: number | null;
  chatId?: string;
  messageId?: string;
  messageIds?: string[];
  newLastMessage?: ChatPreview | null;
  message?: ChatMessage;
  messages?: ChatMessage[];
  userId?: string;
  online?: boolean;
  /** Набор текста, запись голоса или видео либо загрузка файла в событии `typing`. */
  action?: Loose<ChatActionType>;
  /** Доля завершённой загрузки от 0 до 1 в событии `typing`. */
  progress?: number;
  lastReadMessage?: string;
  reactions?: ChatReactionCount[];
  reactionVersion?: string;
  isPinned?: boolean;
  isMuted?: boolean;
  isRequest?: boolean;
  markedUnread?: boolean;
  unreadCount?: number;
  [key: string]: unknown;
}

/** События и `nextEventSeq` для следующего запроса. */
export interface ChatUpdatesPage {
  events: ChatUpdate[];
  nextEventSeq: number;
  /** История изменений устарела и состояние нужно загрузить заново. */
  resetRequired: boolean;
  chats?: ChatSummary[];
}
