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
