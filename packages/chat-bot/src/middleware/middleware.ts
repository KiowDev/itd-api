import type { EventMiddlewareLike, EventNext } from 'itd-api';
import type { ChatContext } from '../context/context.js';

/** Обработчик в цепочке бота. Вызов `next()` передаёт управление дальше. */
export type ChatMiddleware<C extends ChatContext = ChatContext> = (
  context: C,
  next: EventNext,
) => unknown | Promise<unknown>;

/** Объект, из которого компоновщик получает обработчик. */
export interface ChatMiddlewareObj<C extends ChatContext = ChatContext> {
  /** Возвращает обработчик, который подключается через `bot.use()`. */
  middleware(): ChatMiddleware<C>;
}

/** Функция или объект промежуточного обработчика. */
export type ChatMiddlewareLike<C extends ChatContext = ChatContext> =
  | ChatMiddleware<C>
  | ChatMiddlewareObj<C>;

/** Преобразует возвращаемое значение обработчика в контракт EventComposer. @internal */
export function adaptMiddleware<C extends ChatContext>(
  middleware: ChatMiddlewareLike<C>,
): EventMiddlewareLike<C> {
  const adapt = (handler: ChatMiddleware<C>) => async (context: C, next: EventNext) => {
    await handler(context, next);
  };
  return typeof middleware === 'function'
    ? adapt(middleware)
    : { middleware: () => adapt(middleware.middleware()) };
}
