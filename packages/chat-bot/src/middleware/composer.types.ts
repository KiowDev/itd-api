import type { ChatContext } from '../context/context.js';
import type { ChatComposer } from './composer.js';

/** Именованные ветки, которые можно регистрировать из разных модулей. */
export interface ChatRouter<K extends PropertyKey, C extends ChatContext = ChatContext> {
  /** Добавляет цепочку для указанного ключа. */
  route(key: K): ChatComposer<C>;
  /** Добавляет цепочку для событий без зарегистрированного маршрута. */
  otherwise(): ChatComposer<C>;
}
