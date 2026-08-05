/**
 * Часы, которыми клиент измеряет время и планирует отложенную работу.
 *
 * Своя реализация нужна прежде всего в тестах: она позволяет проверять тайм-ауты,
 * повторы и переподключение без ожидания в реальном времени.
 */
export interface ItdClock {
  /** Текущее время в миллисекундах с начала эпохи Unix. */
  now(): number;
  /** Планирует вызов после завершения текущего стека и возвращает функцию отмены. */
  schedule(callback: () => void, delay: number): () => void;
}

/** Системные часы, используемые клиентом по умолчанию. */
export const systemClock: ItdClock = Object.freeze({
  now: () => Date.now(),
  schedule(callback: () => void, delay: number): () => void {
    const timer = setTimeout(callback, delay);
    return () => clearTimeout(timer);
  },
});

/** Общий срок на несколько ожиданий. @internal */
export interface Deadline {
  /** Ждёт промис. `false` — срок истёк раньше, чем промис завершился. */
  wait(promise: Promise<unknown>): Promise<boolean>;
  /** Снимает таймер: без этого он удерживает event loop до конца срока. */
  cancel(): void;
}

/**
 * Заводит срок, общий на все ожидания: от ожидания к ожиданию он не продлевается.
 *
 * @param timeout срок в миллисекундах; `0` — ждать без ограничения
 * @internal
 */
export function createDeadline(timeout: number, clock: ItdClock = systemClock): Deadline {
  if (timeout <= 0) {
    return {
      wait: async (promise) => {
        await promise;
        return true;
      },
      cancel: () => {},
    };
  }

  let expire!: () => void;
  const expired = new Promise<void>((resolve) => {
    expire = resolve;
  });

  return {
    wait: (promise) => Promise.race([promise.then(() => true), expired.then(() => false)]),
    cancel: clock.schedule(() => expire(), timeout),
  };
}
