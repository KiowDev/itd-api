import type { ResolvedRateLimitOptions } from './config.js';
import { ItdAbortError } from './errors.js';

/** Задача, ожидающая своей очереди. */
interface QueuedTask {
  run: () => void;
  /** Снимает задачу, ещё не начавшую выполняться, — используется при остановке очереди. */
  cancel: (reason: unknown) => void;
}

/** Ошибка отмены запроса, который ещё не дошёл до транспорта. */
function queueAbortError(): ItdAbortError {
  return new ItdAbortError('Запрос отменён во время ожидания очереди');
}

/**
 * Очередь запросов: ограничивает одновременность и частоту.
 *
 * Нужна прежде всего ботам: без неё цикл по сотне постов уходит в API одним залпом
 * и упирается в `RATE_LIMIT_EXCEEDED`.
 *
 * Частота выдерживается равномерным разносом стартов (`1000 / rps` между запросами),
 * а не окном со счётчиком: так нагрузка ровная, без всплеска в начале каждой секунды.
 *
 * @internal
 */
export class RequestQueue {
  readonly #concurrency: number;
  /** Минимальный промежуток между стартами, мс. `0` — без ограничения частоты. */
  readonly #minGap: number;

  readonly #waiting: QueuedTask[] = [];
  #active = 0;
  /** Момент, раньше которого следующий запрос стартовать не должен. */
  #nextSlot = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;

  constructor(options: ResolvedRateLimitOptions) {
    this.#concurrency = options.concurrency;
    this.#minGap = options.rps ? 1000 / options.rps : 0;
  }

  /** Сколько задач выполняется прямо сейчас. */
  get active(): number {
    return this.#active;
  }

  /** Сколько задач ждёт очереди. */
  get pending(): number {
    return this.#waiting.length;
  }

  /**
   * Ставит задачу в очередь.
   *
   * @returns результат задачи; ошибка задачи пробрасывается без изменений
   */
  schedule<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) return Promise.reject(queueAbortError());

    return new Promise<T>((resolve, reject) => {
      let queued: QueuedTask;

      const detach = () => signal?.removeEventListener('abort', onAbort);
      const onAbort = () => {
        const index = this.#waiting.indexOf(queued);
        if (index < 0) return;

        this.#waiting.splice(index, 1);
        queued.cancel(queueAbortError());
        this.#drain();
      };

      queued = {
        run: () => {
          detach();
          this.#active += 1;

          // `task` обычно возвращает промис, но пользовательский middleware может бросить
          // синхронно. Нормализуем оба пути, чтобы слот всегда освободился.
          Promise.resolve()
            .then(task)
            .then(resolve, reject)
            .finally(() => {
              this.#active -= 1;
              this.#drain();
            });
        },
        cancel: (reason) => {
          detach();
          reject(reason);
        },
      };

      this.#waiting.push(queued);
      signal?.addEventListener('abort', onAbort, { once: true });

      // Защищает и от нестандартной реализации AbortSignal, которая могла перейти
      // в aborted между первой проверкой и установкой обработчика.
      if (signal?.aborted) onAbort();
      else this.#drain();
    });
  }

  /**
   * Останавливает очередь: снимает отложенную паузу и отклоняет ещё не начатые задачи
   * ошибкой `ItdAbortError`. Уже выполняющиеся задачи доводятся до конца.
   */
  stop(): void {
    if (this.#timer !== undefined) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }
    this.#nextSlot = 0;

    const pending = this.#waiting.splice(0, this.#waiting.length);
    for (const task of pending) {
      task.cancel(new ItdAbortError('Клиент закрыт, запрос отменён'));
    }
  }

  /**
   * Придерживает всю очередь на заданное время.
   *
   * Вызывается при получении `429` с заголовком `Retry-After`: тормозить нужно все запросы,
   * а не только тот, который наткнулся на лимит, — иначе остальные продолжат добивать API.
   */
  pause(ms: number): void {
    if (ms <= 0) return;
    this.#nextSlot = Math.max(this.#nextSlot, Date.now() + ms);
  }

  /** Запускает столько ожидающих задач, сколько позволяют ограничения. */
  #drain(): void {
    if (this.#waiting.length === 0) {
      // Последний ожидающий запрос мог быть отменён во время длинной паузы. Таймер больше
      // не нужен и не должен удерживать event loop процесса.
      if (this.#timer !== undefined) {
        clearTimeout(this.#timer);
        this.#timer = undefined;
      }
      return;
    }
    if (this.#active >= this.#concurrency) return;
    // Ждём уже запланированного пробуждения, чтобы не плодить таймеры.
    if (this.#timer !== undefined) return;

    const now = Date.now();

    if (this.#nextSlot > now) {
      this.#timer = setTimeout(() => {
        this.#timer = undefined;
        this.#drain();
      }, this.#nextSlot - now);
      return;
    }

    const next = this.#waiting.shift();
    if (!next) return;

    if (this.#minGap > 0) this.#nextSlot = now + this.#minGap;

    next.run();

    // Следующая задача может стартовать сразу, если позволяет конкурентность.
    this.#drain();
  }
}

/**
 * Очереди по хостам: основная и по одной на каждый сервис платформы.
 *
 * @internal
 */
export class RequestQueuePool {
  readonly #options: ResolvedRateLimitOptions;
  readonly #main: RequestQueue;
  /** Очереди сервисов заводятся при первом запросе — обычно не нужна ни одна. */
  readonly #byService = new Map<string, RequestQueue>();

  constructor(options: ResolvedRateLimitOptions) {
    this.#options = options;
    this.#main = new RequestQueue(options);
  }

  /** Очередь хоста. */
  for(service: string | undefined): RequestQueue {
    if (service === undefined) return this.#main;

    let queue = this.#byService.get(service);
    if (!queue) {
      queue = new RequestQueue(this.#options);
      this.#byService.set(service, queue);
    }
    return queue;
  }

  /** Останавливает все очереди. */
  stop(): void {
    this.#main.stop();
    for (const queue of this.#byService.values()) queue.stop();
  }
}
