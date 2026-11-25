import { ChatBotLifecycleEvent } from './lifecycle.enum.js';
import type { ChatBotLifecycleEvents } from './lifecycle.types.js';

const eventNames: readonly string[] = Object.values(ChatBotLifecycleEvent);

/** Проверяет, относится ли имя к событиям жизненного цикла. */
export function isLifecycleEvent(value: unknown): value is ChatBotLifecycleEvent {
  return typeof value === 'string' && eventNames.includes(value);
}

export type LifecycleHandler = (payload: never) => unknown;

/** Вызывает обработчики жизненного цикла отдельно от очереди сообщений. */
export class ChatBotLifecycle {
  readonly #handlers = new Map<ChatBotLifecycleEvent, LifecycleHandler[]>();
  readonly #onError: (error: unknown) => void;

  constructor(onError: (error: unknown) => void) {
    this.#onError = onError;
  }

  /** Добавляет обработчики в порядке регистрации. */
  on(event: ChatBotLifecycleEvent, handlers: readonly LifecycleHandler[]): void {
    const listeners = this.#handlers.get(event) ?? [];
    listeners.push(...handlers);
    this.#handlers.set(event, listeners);
  }

  /** Откладывает вызов до завершения перехода канала, например перед вызовом `stop()`. */
  emit<E extends ChatBotLifecycleEvent>(
    event: E,
    payload: ChatBotLifecycleEvents[E],
    shouldDeliver?: () => boolean,
  ): void {
    for (const handler of this.#handlers.get(event) ?? []) {
      void Promise.resolve()
        .then(() => {
          if (!shouldDeliver || shouldDeliver()) return handler(payload as never);
        })
        .catch(this.#onError);
    }
  }
}
