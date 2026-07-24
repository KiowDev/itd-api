import type { Logger } from '../types/options.js';

/** Обработчик события. */
export type Listener<T> = (payload: T) => void;

/** Функция отписки, которую возвращает подписка на событие. */
export type Unsubscribe = () => void;

/**
 * Минимальный типизированный источник событий.
 *
 * Своя реализация вместо `EventTarget` и `EventEmitter`: первый есть не везде и требует
 * обёрток `CustomEvent`, второй существует только в Node. Нужны ровно подписка и рассылка.
 *
 * Исключение в обработчике не прерывает рассылку остальным и не роняет библиотеку.
 *
 * @typeParam Events карта «имя события → тип полезной нагрузки». Задаётся интерфейсом,
 * поэтому ограничение на индексную сигнатуру намеренно не накладывается.
 */
export class Emitter<Events> {
  readonly #listeners = new Map<keyof Events, Set<Listener<never>>>();
  readonly #onError: ((error: unknown) => void) | undefined;

  constructor(onListenerError?: (error: unknown) => void) {
    this.#onError = onListenerError;
  }

  /**
   * Подписывается на событие.
   *
   * @returns функция отписки
   *
   * @example
   * ```ts
   * const off = realtime.on('notification', (event) => console.log(event));
   * off();
   * ```
   */
  on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): Unsubscribe {
    const set = this.#listeners.get(event) ?? new Set();
    set.add(listener as Listener<never>);
    this.#listeners.set(event, set);

    return () => this.off(event, listener);
  }

  /** Подписывается на одно срабатывание. */
  once<K extends keyof Events>(event: K, listener: Listener<Events[K]>): Unsubscribe {
    const off = this.on(event, (payload) => {
      off();
      listener(payload);
    });
    return off;
  }

  /** Отписывается от события. */
  off<K extends keyof Events>(event: K, listener: Listener<Events[K]>): void {
    this.#listeners.get(event)?.delete(listener as Listener<never>);
  }

  /** Рассылает событие подписчикам. */
  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const set = this.#listeners.get(event);
    if (!set) return;

    // Копия нужна: обработчик вправе отписаться прямо во время рассылки.
    for (const listener of [...set]) {
      try {
        (listener as Listener<Events[K]>)(payload);
      } catch (error) {
        this.#onError?.(error);
      }
    }
  }

  /** Сколько подписчиков у события. */
  listenerCount(event: keyof Events): number {
    return this.#listeners.get(event)?.size ?? 0;
  }

  /** Снимает все подписки. */
  removeAllListeners(): void {
    this.#listeners.clear();
  }
}

/**
 * Сообщает об исключении из пользовательского обработчика события: пишет в логгер,
 * при его отсутствии — в консоль.
 *
 * Ошибка чужого обработчика не должна ронять библиотеку, но и пропадать молча ей нельзя:
 * иначе подписка, падающая на каждом событии, выглядит как её отсутствие.
 *
 * @param scope о чьих событиях речь — попадает в текст сообщения
 *
 * @internal
 */
export function reportListenerError(
  logger: Logger | undefined,
  scope: string,
  error: unknown,
): void {
  const message = `Ошибка в обработчике события ${scope}`;
  if (logger) logger.error(message, error);
  else console.error(`[itd-api] ${message}`, error);
}
