import {
  type ChatMessage,
  type ChatMessageReactions,
  type ChatReaction,
  ChatReactionType,
  type ChatsApi,
  ItdErrorKind,
  ItdTimeoutError,
  isItdConflictError,
  isItdError,
  type RequestOptions,
  TimeoutBudget,
} from 'itd-api';

/** Сравнивает реакцию с выбором бота по эмодзи или ID изображения. */
function hasReaction(state: ChatMessageReactions, reaction: ChatReaction): boolean {
  return state.reactions.some(({ chosen, reaction: current }) => {
    if (chosen !== true) return false;
    return reaction.type === ChatReactionType.Emoji
      ? current.type === reaction.type && current.emoji === reaction.emoji
      : current.type === reaction.type && current.fileId === reaction.fileId;
  });
}

/** Добавляет реакцию с проверкой версии и перечитывает состояние при конфликте. */
export async function addReaction(
  chats: Pick<ChatsApi, 'reactions' | 'setReactions'>,
  chatId: string,
  messageId: string,
  input: string | ChatReaction,
  message: ChatMessage | undefined,
  options: RequestOptions | undefined,
): Promise<ChatMessageReactions> {
  const reaction =
    typeof input === 'string' ? { type: ChatReactionType.Emoji, emoji: input } : input;
  const deadline = options?.deadline;
  const started = performance.now();

  // Передаём остаток срока, чтобы каждый следующий запрос не получал новый полный бюджет.
  const request = (method: 'GET' | 'PUT'): RequestOptions | undefined => {
    options?.signal?.throwIfAborted();
    if (deadline === undefined || deadline <= 0) return options;
    const remaining = Math.ceil(deadline - (performance.now() - started));
    if (remaining > 0) return { ...options, deadline: remaining };
    throw new ItdTimeoutError({
      timeout: deadline,
      method,
      path: `/api/v1/messenger/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/reactions`,
      budget: TimeoutBudget.Deadline,
    });
  };

  const read = async () =>
    chats.reactions(chatId, messageId, {
      ...request('GET'),
      extensions: { ...options?.extensions, cache: 'reload' },
    });

  const add = async (state: ChatMessageReactions): Promise<ChatMessageReactions> => {
    if (hasReaction(state, reaction)) return state;
    const reactions = state.reactions
      .filter(({ chosen }) => chosen === true)
      .map((entry) => entry.reaction);
    const operationId =
      globalThis.crypto?.randomUUID?.() ?? (await import('node:crypto')).randomUUID();
    try {
      return await chats.setReactions(
        chatId,
        messageId,
        {
          reactions: [...reactions, reaction],
          expectedVersion: state.reactionVersion,
          operationId,
        },
        request('PUT'),
      );
    } catch (error) {
      if (
        isItdError(error) &&
        (error.kind === ItdErrorKind.Network ||
          (error instanceof ItdTimeoutError && error.budget === TimeoutBudget.Attempt))
      ) {
        // Запись могла пройти до обрыва связи. Проверяем результат без новой записи.
        const current = await read().catch(() => undefined);
        options?.signal?.throwIfAborted();
        if (current && hasReaction(current, reaction)) return current;
      }
      throw error;
    }
  };

  const initial =
    message?.reactions?.length === 0 && message.reactionVersion
      ? { messageId, reactions: [], reactionVersion: message.reactionVersion }
      : await read();
  try {
    return await add(initial);
  } catch (error) {
    if (!isItdConflictError(error)) throw error;
    return add(await read());
  }
}
