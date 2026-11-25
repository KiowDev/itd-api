import type { ChatContext } from '../context/context.js';

/** Настройки ограничения частоты обработки событий. */
export interface RateLimiterOptions<C extends ChatContext = ChatContext> {
  /** Максимум событий на один ключ за окно. */
  limit: number;
  /** Длительность окна в миллисекундах. Окно начинается с первого события по ключу. */
  window: number;
  /** Вычисляет ключ для события. `undefined` пропускает проверку. По умолчанию используется ID автора входящего сообщения. */
  key?: (context: C) => string | undefined;
  /** Вызывается при первом превышении лимита по ключу за окно. */
  onLimit?: (context: C) => unknown;
}
