import type { ItdClient } from 'itd-api';
import type { ChatContext } from './context/context.js';
import type { ChatBotClient } from './context/context.types.js';
import type { ChatCheckpointOptions } from './runtime/checkpoint.js';

/** Обработчик исходной ошибки команды или middleware и контекста события. */
export type ChatBotErrorHandler<C extends ChatContext = ChatContext> = (
  error: unknown,
  context: C,
) => unknown | Promise<unknown>;

/** Настройки обработки событий и создания контекста. */
export type ChatBotOptions<
  Client extends ChatBotClient = ItdClient,
  C extends ChatContext<Client> = ChatContext<Client>,
> = {
  /** Сколько чатов обрабатывать одновременно. По умолчанию 1. */
  concurrency?: number;
  /** Максимум обновлений в очереди. Обновления, которые уже обрабатываются, в лимит не входят. По умолчанию 256. */
  maxPendingUpdates?: number;
  /** Где хранить номер последнего обработанного события между запусками. */
  checkpoint?: ChatCheckpointOptions;
  /** Префиксы команд бота и его модулей. По умолчанию `['/']`. */
  commandPrefixes?: readonly string[];
} & (ChatContext<Client> extends C
  ? { createContext?: (...args: ConstructorParameters<typeof ChatContext<Client>>) => C }
  : { createContext: (...args: ConstructorParameters<typeof ChatContext<Client>>) => C });
