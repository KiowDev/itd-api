/** Имена событий жизненного цикла для `bot.on()`. */
export const ChatBotLifecycleEvent = Object.freeze({
  /** WebSocket открыт. */
  Connect: 'connect',
  /** Запланировано переподключение. */
  Reconnect: 'reconnect',
  /** Бот остановлен. */
  Stop: 'stop',
  /** Получение событий завершилось ошибкой. */
  Error: 'error',
} as const);

/** Значение из `ChatBotLifecycleEvent`. */
export type ChatBotLifecycleEvent =
  (typeof ChatBotLifecycleEvent)[keyof typeof ChatBotLifecycleEvent];
