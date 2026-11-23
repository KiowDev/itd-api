import type {
  ChatChange,
  ChatDeletedMessages,
  ChatDirectResult,
  ChatEditedMessage,
  ChatFirstMessage,
  ChatForwardedMessages,
  ChatHistoryPage,
  ChatListPage,
  ChatMediaPage,
  ChatMessage,
  ChatMessageReactions,
  ChatPreview,
  ChatReaction,
  ChatReactionCatalog,
  ChatReactionCount,
  ChatReadCursor,
  ChatReadResult,
  ChatReply,
  ChatSentMessage,
  ChatSummary,
  ChatTextEntity,
  ChatUnreadState,
  ChatUpdate,
  ChatUpdatesPage,
} from '../models/chats.js';
import { ChatReactionType } from '../models/chats.js';

import type {
  Comment,
  CommentUpdateResult,
  OriginalPost,
  Post,
  PostUpdateResult,
} from '../models/content.js';
import { utcStampToIso } from './time.js';

/** Поле с датой, приведённой к ISO-8601; без строкового значения поле не появляется. */
function isoField<K extends string>(key: K, value: unknown): Partial<Record<K, string>> {
  return typeof value === 'string' ? ({ [key]: utcStampToIso(value) } as Record<K, string>) : {};
}

function nullableIsoField<K extends string>(
  key: K,
  value: unknown,
): Partial<Record<K, string | null>> {
  return value === null ? ({ [key]: null } as Record<K, null>) : isoField(key, value);
}

/** Приводит даты комментария и его ответов к ISO-8601. */
export function normalizeComment(comment: Comment): Comment {
  if (typeof comment !== 'object' || comment === null) return comment;
  return {
    ...comment,
    ...isoField('createdAt', comment.createdAt),
    ...(Array.isArray(comment.replies) ? { replies: comment.replies.map(normalizeComment) } : {}),
  };
}

function normalizeOriginalPost(post: OriginalPost): OriginalPost {
  return { ...post, ...isoField('createdAt', post.createdAt) };
}

/** Приводит даты поста, исходного поста репоста и вложенных комментариев к ISO-8601. */
export function normalizePost(post: Post): Post {
  if (typeof post !== 'object' || post === null) return post;
  return {
    ...post,
    ...isoField('createdAt', post.createdAt),
    ...isoField('editedAt', post.editedAt),
    ...(post.originalPost ? { originalPost: normalizeOriginalPost(post.originalPost) } : {}),
    ...(Array.isArray(post.comments) ? { comments: post.comments.map(normalizeComment) } : {}),
  };
}

/** Читает ответ редактирования поста: `updatedAt` сервера становится `editedAt`. */
export function normalizePostUpdate(body: unknown): PostUpdateResult {
  const { updatedAt, ...rest } = body as Omit<PostUpdateResult, 'editedAt'> & {
    updatedAt: string;
  };
  return { ...rest, editedAt: utcStampToIso(updatedAt) };
}

/** Читает ответ редактирования комментария. */
export function normalizeCommentUpdate(body: unknown): CommentUpdateResult {
  const result = body as CommentUpdateResult;
  return { ...result, editedAt: utcStampToIso(result.editedAt) };
}

type WireRecord = Record<string, unknown>;

/** Дополняет копию ответа нормализованными полями, пропуская `undefined`. */
function withFields<T>(rest: WireRecord, fields: WireRecord): T {
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) rest[key] = value;
  }
  return rest as T;
}

function mapItems<T>(value: unknown, normalize: (item: unknown) => T) {
  return Array.isArray(value) ? value.map(normalize) : value;
}

function normalizePreview(body: unknown): ChatPreview | null | undefined {
  if (body == null) return body;
  const { sender_id, at, attachment_kind, attachment_filename, attachment_count, ...rest } =
    body as WireRecord;
  return withFields(rest, {
    senderId: sender_id,
    ...nullableIsoField('at', at),
    attachmentKind: attachment_kind,
    attachmentFilename: attachment_filename,
    attachmentCount: attachment_count,
  });
}

/** Читает сводку чата и последнее сообщение. */
export function normalizeChatSummary(body: unknown): ChatSummary {
  const {
    chat_id,
    chat_type,
    other_user_id,
    other_user_deleted,
    other_read_message_id,
    my_read_message_id,
    unread_count,
    marked_unread,
    is_request,
    is_pinned,
    is_muted,
    last_message,
    ...rest
  } = body as WireRecord;
  return withFields(rest, {
    chatId: chat_id,
    chatType: chat_type,
    otherUserId: other_user_id,
    otherUserDeleted: other_user_deleted,
    otherReadMessageId: other_read_message_id,
    myReadMessageId: my_read_message_id,
    unreadCount: unread_count,
    markedUnread: marked_unread,
    isRequest: is_request,
    isPinned: is_pinned,
    isMuted: is_muted,
    lastMessage: normalizePreview(last_message),
  });
}

/** Читает страницу чатов, включая курсор и номер последнего события. */
export function normalizeChatList(body: unknown): ChatListPage {
  const { chats, next_before, event_seq, ...rest } = body as WireRecord;
  return withFields(rest, {
    chats: mapItems(chats, normalizeChatSummary),
    nextBefore: next_before,
    eventSeq: event_seq,
  });
}

/** Читает счётчики непрочитанного. */
export function normalizeChatUnread(body: unknown): ChatUnreadState {
  const { chats_with_unread, event_seq, ...rest } = body as WireRecord;
  return withFields(rest, { chatsWithUnread: chats_with_unread, eventSeq: event_seq });
}

/** Читает результат открытия личного диалога. */
export function normalizeChatDirect(body: unknown): ChatDirectResult {
  const { chat_id, ...rest } = body as WireRecord;
  return withFields(rest, { chatId: chat_id });
}

function normalizeEntity(body: unknown): ChatTextEntity {
  const { post_id, sticker_id, ...rest } = body as WireRecord;
  return withFields(rest, { postId: post_id, stickerId: sticker_id });
}

function normalizeReaction(body: unknown): ChatReaction {
  const { file_id, ...rest } = body as WireRecord;
  return withFields(rest, { fileId: file_id });
}

function normalizeReactionCount(body: unknown): ChatReactionCount {
  const { reaction, ...rest } = body as WireRecord;
  return withFields(rest, { reaction: normalizeReaction(reaction) });
}

function normalizeReply(body: unknown): ChatReply | null | undefined {
  if (body == null) return body;
  const { message_id, sender_id, sender_name, ...rest } = body as WireRecord;
  return withFields(rest, { messageId: message_id, senderId: sender_id, senderName: sender_name });
}

function normalizeMessage(body: unknown): ChatMessage {
  const {
    message_id,
    sender_id,
    created_at,
    reactions,
    reaction_version,
    reply_to,
    entities,
    is_deleted,
    forwarded_from_chat,
    forwarded_from_msg,
    forwarded_from_sender_id,
    forwarded_from_name,
    edited_at,
    client_message_id,
    ...rest
  } = body as WireRecord;
  return withFields(rest, {
    messageId: message_id,
    senderId: sender_id,
    ...isoField('createdAt', created_at),
    reactions: mapItems(reactions, normalizeReactionCount),
    reactionVersion: reaction_version,
    replyTo: normalizeReply(reply_to),
    entities: mapItems(entities, normalizeEntity),
    isDeleted: is_deleted,
    forwardedFromChatId: forwarded_from_chat,
    forwardedFromMessageId: forwarded_from_msg,
    forwardedFromSenderId: forwarded_from_sender_id,
    forwardedFromName: forwarded_from_name,
    ...nullableIsoField('editedAt', edited_at),
    clientMessageId: client_message_id,
  });
}

function normalizeReadCursor(body: unknown): ChatReadCursor | null | undefined {
  if (body == null) return body;
  const { message_id, timestamp, ...rest } = body as WireRecord;
  return withFields(rest, { messageId: message_id, ...nullableIsoField('timestamp', timestamp) });
}

/** Читает страницу истории. Ключи карты прочтения — ID участников. */
export function normalizeChatHistory(body: unknown): ChatHistoryPage {
  const {
    messages,
    read_cursors,
    my_last_read,
    has_older,
    has_newer,
    event_seq,
    target_message_id,
    ...rest
  } = body as WireRecord;
  return withFields(rest, {
    messages: mapItems(messages, normalizeMessage),
    readCursors:
      read_cursors == null
        ? read_cursors
        : Object.fromEntries(
            Object.entries(read_cursors).map(([userId, cursor]) => [
              userId,
              normalizeReadCursor(cursor),
            ]),
          ),
    myLastRead: normalizeReadCursor(my_last_read),
    hasOlder: has_older,
    hasNewer: has_newer,
    eventSeq: event_seq,
    targetMessageId: target_message_id,
  });
}

/** Читает страницу вложений из истории чата. */
export function normalizeChatMedia(body: unknown): ChatMediaPage {
  const { items, next_before, ...rest } = body as WireRecord;
  return withFields(rest, {
    items: mapItems(items, (item) => {
      const { message_id, sender_id, created_at, ...file } = item as WireRecord;
      return withFields(file, {
        messageId: message_id,
        senderId: sender_id,
        ...isoField('createdAt', created_at),
      });
    }),
    nextBefore: next_before,
  });
}

/** Читает каталог реакций. */
export function normalizeChatReactionCatalog(body: unknown): ChatReactionCatalog {
  const { reactions, user_max, ...rest } = body as WireRecord;
  return withFields(rest, { reactions: mapItems(reactions, normalizeReaction), userMax: user_max });
}

/** Читает текущее состояние реакций на сообщение. */
export function normalizeChatReactions(body: unknown): ChatMessageReactions {
  const { message_id, reactions, reaction_version, ...rest } = body as WireRecord;
  return withFields(rest, {
    messageId: message_id,
    reactions: mapItems(reactions, normalizeReactionCount),
    reactionVersion: reaction_version,
  });
}

function changeFields<T extends ChatChange>(body: unknown): T {
  const { event_seq, event_seq_count, ...rest } = body as WireRecord;
  return withFields(rest, { eventSeq: event_seq, eventSeqCount: event_seq_count });
}

/** Читает номер события из ответа очистки истории или удаления чата. */
export function normalizeChatChange(body: unknown): ChatChange | undefined {
  return body == null ? undefined : changeFields(body);
}

/** Читает результат удаления сообщений. */
export function normalizeChatDeleted(body: unknown): ChatDeletedMessages {
  return changeFields(body);
}

/** Читает результат отправки сообщения. */
export function normalizeChatSent(body: unknown): ChatSentMessage {
  const { message_id, client_message_id, created_at, ...rest } = body as WireRecord;
  return withFields(
    { ...changeFields(rest) },
    {
      messageId: message_id,
      clientMessageId: client_message_id,
      ...isoField('createdAt', created_at),
    },
  );
}

/** Читает результат отправки по ID собеседника. */
export function normalizeChatFirstMessage(body: unknown): ChatFirstMessage {
  const { chat_id, ...rest } = body as WireRecord;
  return withFields({ ...normalizeChatSent(rest) }, { chatId: chat_id });
}

/** Читает результат редактирования. */
export function normalizeChatEdited(body: unknown): ChatEditedMessage {
  const { message_id, edited_at, entities, ...rest } = body as WireRecord;
  return withFields(
    { ...changeFields(rest) },
    {
      messageId: message_id,
      ...nullableIsoField('editedAt', edited_at),
      entities: mapItems(entities, normalizeEntity),
    },
  );
}

/** Читает результат пересылки. */
export function normalizeChatForwarded(body: unknown): ChatForwardedMessages {
  const { ok, ...rest } = body as WireRecord;
  return withFields(
    { ...changeFields(rest) },
    {
      ok: mapItems(ok, (item) => {
        const {
          source_message_id,
          message_id,
          created_at,
          forwarded_from_sender_id,
          forwarded_from_name,
          ...fields
        } = item as WireRecord;
        return withFields(fields, {
          sourceMessageId: source_message_id,
          messageId: message_id,
          ...isoField('createdAt', created_at),
          forwardedFromSenderId: forwarded_from_sender_id,
          forwardedFromName: forwarded_from_name,
        });
      }),
    },
  );
}

/** Читает результат отметки о прочтении. */
export function normalizeChatRead(body: unknown): ChatReadResult {
  const { last_read_message, remaining_unread, ...rest } = body as WireRecord;
  return withFields(
    { ...changeFields(rest) },
    {
      lastReadMessage: last_read_message,
      remainingUnread: remaining_unread,
    },
  );
}

/** Читает событие из REST или WebSocket с его вложенными сообщениями. */
export function normalizeChatUpdate(body: unknown): ChatUpdate {
  const {
    chat_id,
    message_id,
    message_ids,
    user_id,
    last_read_message,
    new_last_message,
    message,
    messages,
    reactions,
    reaction_version,
    is_pinned,
    is_muted,
    is_request,
    marked_unread,
    unread_count,
    ...rest
  } = body as WireRecord;
  return withFields(
    { ...changeFields(rest) },
    {
      chatId: chat_id,
      messageId: message_id,
      messageIds: message_ids,
      userId: user_id,
      lastReadMessage: last_read_message,
      newLastMessage: normalizePreview(new_last_message),
      message: message == null ? message : normalizeMessage(message),
      messages: mapItems(messages, normalizeMessage),
      reactions: mapItems(reactions, normalizeReactionCount),
      reactionVersion: reaction_version,
      isPinned: is_pinned,
      isMuted: is_muted,
      isRequest: is_request,
      markedUnread: marked_unread,
      unreadCount: unread_count,
    },
  );
}

/** Читает страницу событий и сводки изменившихся чатов. */
export function normalizeChatUpdates(body: unknown): ChatUpdatesPage {
  const { events, next_event_seq, reset_required, chats, ...rest } = body as WireRecord;
  return withFields(rest, {
    events: mapItems(events, normalizeChatUpdate),
    nextEventSeq: next_event_seq,
    resetRequired: reset_required,
    chats: mapItems(chats, normalizeChatSummary),
  });
}

/** Преобразует форматирование сообщения в формат API. */
export function writeChatEntity({ postId, stickerId, ...entity }: ChatTextEntity) {
  return { ...entity, post_id: postId, sticker_id: stickerId };
}

/** Преобразует пользовательскую реакцию в формат API. */
export function writeChatReaction(reaction: ChatReaction) {
  return reaction.type === ChatReactionType.Custom
    ? { type: reaction.type, file_id: reaction.fileId }
    : { type: reaction.type, emoji: reaction.emoji };
}
