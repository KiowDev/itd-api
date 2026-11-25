import type { ChatEventMap } from 'itd-api';
import { ChatBotLifecycleEvent } from './lifecycle.enum.js';

/** Полезная нагрузка событий жизненного цикла. */
export interface ChatBotLifecycleEvents {
  /** Сокет открыт или бот подключился к уже открытому каналу. */
  [ChatBotLifecycleEvent.Connect]: undefined;
  /** Канал запланировал повторную попытку подключения. Задержка указана в миллисекундах. */
  [ChatBotLifecycleEvent.Reconnect]: ChatEventMap['reconnect'];
  /** Бот остановлен. Для ожидания обработчиков используйте `drain()`. */
  [ChatBotLifecycleEvent.Stop]: undefined;
  /** Окончательная ошибка получения или восстановления событий. */
  [ChatBotLifecycleEvent.Error]: unknown;
}
