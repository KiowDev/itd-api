import type { ChatContext } from './context/context.js';

/** Ошибка обработчика, переданная в логгер вместе с контекстом события. Исходная ошибка доступна в `cause`. */
export class ChatBotError<C extends ChatContext = ChatContext> extends Error {
  /** Контекст события, на котором произошла ошибка. */
  readonly context: C;

  constructor(error: unknown, context: C) {
    super('Ошибка обработчика чат-бота', { cause: error });
    this.name = 'ChatBotError';
    this.context = context;
  }
}
