import {
  type ChatMessage,
  type ChatUpdate,
  ChatUpdateType,
  ItdAbortError,
  type Logger,
} from 'itd-api';
import { ChatBotError } from '../bot.errors.js';
import type { ChatBotErrorHandler } from '../bot.types.js';
import {
  type ChatContext,
  failedChatContexts,
  incomingChatCreatedContexts,
} from '../context/context.js';
import type { ChatBotClient } from '../context/context.types.js';
import type { ChatMiddleware } from '../middleware/middleware.js';

/** Выделяет сообщения, для которых бот должен запустить обработчики отдельно. */
function eventMessages(update: ChatUpdate): readonly (ChatMessage | undefined)[] {
  switch (update.type) {
    case ChatUpdateType.NewMessage:
    case ChatUpdateType.MessageEdited:
      return [update.message];
    case ChatUpdateType.NewMessages:
    case ChatUpdateType.OwnMessages:
    case ChatUpdateType.ChatCreated:
      return update.messages?.length ? update.messages : [undefined];
    default:
      return [undefined];
  }
}

/** Создаёт контексты и передаёт обновление в цепочку обработчиков. */
export class ChatUpdateDispatcher<Client extends ChatBotClient, C extends ChatContext<Client>> {
  readonly #itd: Client;
  readonly #createContext: (...args: ConstructorParameters<typeof ChatContext<Client>>) => C;
  readonly #middleware: ChatMiddleware<C>;
  readonly #userIds = new WeakMap<AbortSignal, Promise<string | undefined>>();
  /** Обработчик ошибок команд и middleware. */
  errorHandler: ChatBotErrorHandler<C> | undefined;

  constructor(
    itd: Client,
    createContext: (...args: ConstructorParameters<typeof ChatContext<Client>>) => C,
    middleware: ChatMiddleware<C>,
  ) {
    this.#itd = itd;
    this.#createContext = createContext;
    this.#middleware = middleware;
  }

  /** Запускает обработчики для каждого сообщения из события по порядку. */
  async dispatch(update: ChatUpdate, signal: AbortSignal, logger: Logger): Promise<boolean> {
    let userId: Promise<string | undefined> | undefined;
    let handled = true;
    for (const message of eventMessages(update)) {
      if (signal.aborted) return false;
      const context = this.#createContext(this.#itd, update, message, signal);
      try {
        if (update.type === ChatUpdateType.ChatCreated && message?.senderId) {
          userId ??= this.#getUserId(signal);
          const ownId = await userId;
          if (signal.aborted) return false;
          if (ownId && message.senderId !== ownId) incomingChatCreatedContexts.add(context);
        }
        await this.#middleware(context, async () => {});
      } catch (error) {
        if (signal.aborted && error instanceof ItdAbortError) return false;
        handled = false;
        if (!this.errorHandler) {
          logger.error('Ошибка обработчика чат-бота', new ChatBotError(error, context));
          continue;
        }
        try {
          await this.errorHandler(error, context);
        } catch (handlerError) {
          logger.error(
            'Ошибка обработчика ошибок чат-бота',
            new ChatBotError(handlerError, context),
          );
        }
      } finally {
        if (failedChatContexts.delete(context)) handled = false;
      }
    }
    return handled && !signal.aborted;
  }

  /** Получает ID аккаунта один раз за запуск. После ошибки разрешает повторное чтение. */
  #getUserId(signal: AbortSignal): Promise<string | undefined> {
    const pending = this.#userIds.get(signal);
    if (pending) return pending;

    const userId = (async () => {
      const id = await this.#itd.getUserId?.();
      signal.throwIfAborted();
      return id ?? (await this.#itd.users?.me({ signal }))?.id;
    })().catch((error: unknown) => {
      this.#userIds.delete(signal);
      throw error;
    });
    this.#userIds.set(signal, userId);
    return userId;
  }
}
