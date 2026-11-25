import type { ChatUpdateType } from 'itd-api';

/** Фильтры по содержимому сообщения и действиям в чате. */
export const ChatBotFilter = Object.freeze({
  /** Любое входящее сообщение. */
  Message: 'message',
  /** Входящее сообщение с текстом. */
  MessageText: 'message:text',
  /** Входящее сообщение с вложением. */
  MessageAttachment: 'message:attachment',
  /** Входящее сообщение с изображением. */
  MessageImage: 'message:image',
  /** Входящее сообщение с видео. */
  MessageVideo: 'message:video',
  /** Входящее сообщение с аудио, включая голосовые сообщения. */
  MessageAudio: 'message:audio',
  /** Входящее голосовое сообщение. */
  MessageVoice: 'message:voice',
  /** Входящее сообщение с карточкой поста. */
  MessagePost: 'message:post',
  /** Входящий ответ на сообщение. */
  MessageReply: 'message:reply',
  /** Входящее пересланное сообщение. */
  MessageForward: 'message:forward',
  /** Сообщение отредактировано. */
  Edit: 'edit',
  /** Сообщения отмечены прочитанными. */
  Read: 'read',
} as const);

export type KnownUpdateType = (typeof ChatUpdateType)[keyof typeof ChatUpdateType];
/** Фильтр по сообщению или тип обновления из `ChatUpdateType`. */
export type ChatBotFilter = KnownUpdateType | (typeof ChatBotFilter)[keyof typeof ChatBotFilter];
