import {
  BUCKET_LIMITS,
  DEFAULT_RATE_LIMIT_BUCKET,
  isKnownBucket,
  RateLimitPacing,
} from './buckets.js';
import { type ItdClock, systemClock } from './clock.js';
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

/** Ошибка запроса, которого застала остановка очереди. */
function queueStoppedError(): ItdAbortError {
  return new ItdAbortError('Клиент закрыт, запрос отменён');
}

/** Что нужно одной очереди. Полные настройки клиента ей избыточны. */
export interface RequestQueueOptions {
  concurrency: number;
  /** Верхняя граница стартов в секунду. `undefined` — без ограничения частоты. */
  rps?: number | undefined;
  /**
   * Синхронный сигнал «задача пошла», вызывается в момент захвата слота.
   *
   * Именно синхронность здесь существенна: `#drain` запускает подряд столько задач,
   * сколько позволяет конкурентность, и учёт темпа должен успеть придержать очередь
   * до следующей итерации этого цикла.
   */
  onDispatch?: (() => void) | undefined;
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
  readonly #onDispatch: (() => void) | undefined;

  readonly #waiting: QueuedTask[] = [];
  #active = 0;
  /** Момент, раньше которого следующий запрос стартовать не должен. */
  #nextSlot = 0;
  readonly #clock: ItdClock;
  #cancelTimer: (() => void) | undefined;

  constructor(options: RequestQueueOptions, clock: ItdClock = systemClock) {
    this.#concurrency = options.concurrency;
    this.#minGap = options.rps ? 1000 / options.rps : 0;
    this.#onDispatch = options.onDispatch;
    this.#clock = clock;
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
          this.#onDispatch?.();

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
    if (this.#cancelTimer) {
      this.#cancelTimer();
      this.#cancelTimer = undefined;
    }

    const pending = this.#waiting.splice(0, this.#waiting.length);
    for (const task of pending) task.cancel(queueStoppedError());
  }

  /** Придерживает очередь на заданное время: ждут все её задачи, а не только одна. */
  pause(ms: number): void {
    if (ms <= 0) return;
    this.#nextSlot = Math.max(this.#nextSlot, this.#clock.now() + ms);
  }

  /** Запускает столько ожидающих задач, сколько позволяют ограничения. */
  #drain(): void {
    if (this.#waiting.length === 0) {
      // Последний ожидающий запрос мог быть отменён во время длинной паузы. Таймер больше
      // не нужен и не должен удерживать event loop процесса.
      if (this.#cancelTimer) {
        this.#cancelTimer();
        this.#cancelTimer = undefined;
      }
      return;
    }
    if (this.#active >= this.#concurrency) return;
    // Ждём уже запланированного пробуждения, чтобы не плодить таймеры.
    if (this.#cancelTimer) return;

    const now = this.#clock.now();

    if (this.#nextSlot > now) {
      this.#cancelTimer = this.#clock.schedule(() => {
        this.#cancelTimer = undefined;
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

/** Длина окна лимита на сервере. */
const RATE_LIMIT_WINDOW = 60_000;

/**
 * Пауза при исчерпании бакета неизвестной ёмкости.
 *
 * Ёмкость приходит в заголовке вместе с остатком, поэтому случай возможен только у чужого
 * прокси, который прислал `remaining` без `limit`.
 */
const UNKNOWN_CAPACITY_PAUSE = 1000;

/** Снимок одного бакета. */
export interface RateLimitBucketState {
  /** Origin, на котором ведётся счётчик. `undefined` — очередь без известного направления. */
  destination: string | undefined;
  bucket: string;
  /** Ёмкость из последнего ответа; `undefined`, пока ответов не было. */
  limit: number | undefined;
  /** Остаток из последнего ответа. */
  remaining: number | undefined;
  /** Запросов бакета прошло в общую очередь и ещё не завершилось. */
  active: number;
  /** Запросов бакета ждёт своей очереди — из-за паузы или предела одновременности. */
  pending: number;
}

/**
 * Очередь одного бакета поверх общей очереди направления.
 *
 * Задача занимает слот бакета, затем общий слот направления, поэтому суммарная
 * одновременность остаётся равной `concurrency`. Пауза бакета удерживает задачу до
 * захвата общего слота: притормозивший счётчик не занимает общую ёмкость.
 *
 * @internal
 */
export class BucketQueue {
  readonly #destination: string | undefined;
  readonly #bucket: string;
  readonly #gate: RequestQueue;
  readonly #shared: RequestQueue;
  readonly #clock: ItdClock;
  readonly #pacing: RateLimitPacing;
  /** Ровный темп. Требует раздельных бакетов: без них ёмкость счётчика неизвестна. */
  readonly #smooth: boolean;
  /**
   * Пауза на исчерпанный остаток в режиме `buckets: false`; `undefined` — бакеты разделены.
   *
   * Одна очередь на направление принимает заголовки всех счётчиков вперемешку, поэтому
   * `x-ratelimit-limit` принадлежит тому счётчику, который ответил последним, и ёмкость
   * очереди из него не выводится: ответ `posts.create` с ёмкостью 5 остановил бы всё
   * направление на двенадцать секунд. Вместо расчёта берётся первая ступень `retryDelays`.
   */
  readonly #flatPause: number | undefined;
  /** Лимит бакета до первого ответа. */
  readonly #seedLimit: number | undefined;

  /** Последнее, что сказал сервер. Живёт и в режиме `off` — ради `rateLimitState()`. */
  #limit: number | undefined;
  #remaining: number | undefined;

  /**
   * Оценка остатка для режима `smooth`.
   *
   * Начинается с единицы, а не с полной ёмкости: где сейчас граница минутного окна,
   * из ответа не вывести, и считать бакет нетронутым нельзя.
   */
  #tokens = 1;
  #tokensAt: number | undefined;
  /**
   * Номер поколения очереди. `stop()` увеличивает его, отсекая задачи, которые уже взяли
   * слот бакета, но до общей очереди ещё не дошли.
   */
  #generation = 0;

  constructor(
    destination: string | undefined,
    bucket: string,
    shared: RequestQueue,
    options: ResolvedRateLimitOptions,
    clock: ItdClock,
  ) {
    this.#destination = destination;
    this.#bucket = bucket;
    this.#shared = shared;
    this.#clock = clock;
    this.#pacing = options.pacing;
    this.#smooth = options.buckets && options.pacing === RateLimitPacing.Smooth;
    this.#flatPause = options.buckets ? undefined : (options.retryDelays[0] ?? 0);
    this.#seedLimit = options.buckets ? seedLimit(bucket, options) : undefined;
    this.#gate = new RequestQueue(
      {
        // Без раздельных бакетов предел шлюза равен общему, поэтому пропускной способности
        // он не режет. Снять его вовсе нельзя: `#drain` обходит очередь рекурсией и должен
        // упираться в конечную конкурентность.
        concurrency: options.buckets
          ? (options.bucketOverrides[bucket]?.concurrency ?? options.bucketConcurrency)
          : options.concurrency,
        onDispatch: this.#smooth ? () => this.#spend() : undefined,
      },
      clock,
    );
  }

  /** Имя счётчика. При `buckets: false` — всегда `default`, каким бы ни был запрос. */
  get bucket(): string {
    return this.#bucket;
  }

  /** Запросов бакета прошло в общую очередь и ещё не завершилось. */
  get active(): number {
    return this.#gate.active;
  }

  /** Запросов бакета ждёт своей очереди. */
  get pending(): number {
    return this.#gate.pending;
  }

  /** Ставит запрос в очередь: сначала слот бакета, затем общий слот направления. */
  schedule<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const generation = this.#generation;

    return this.#gate.schedule(() => {
      // Между уровнями запрос успевает побыть нигде: слот бакета уже взят, а в общую
      // очередь он попадёт следующей микрозадачей. Остановка, пришедшая в этот момент,
      // не нашла бы его ни в одном из двух списков ожидания.
      if (generation !== this.#generation) return Promise.reject(queueStoppedError());
      return this.#shared.schedule(task, signal);
    }, signal);
  }

  /**
   * Учитывает заголовки ответа.
   *
   * Вызывается после каждого ответа, включая ошибочные: сервер списывает квоту одинаково
   * с `404`, `422` и `200`.
   *
   * @returns на сколько миллисекунд придержан бакет; `0` — темп не ограничен
   */
  observe(limit: number | undefined, remaining: number | undefined): number {
    // Основной транспорт уже отбрасывает некорректный заголовок, но очередь остаётся
    // самостоятельным внутренним примитивом: не позволяем прямому вызову записать
    // нулевую ёмкость и получить бесконечный таймер в режиме smooth.
    if (limit !== undefined && Number.isFinite(limit) && limit > 0) this.#limit = limit;
    if (remaining !== undefined) this.#remaining = remaining;
    if (this.#pacing === RateLimitPacing.Off || remaining === undefined) return 0;

    if (this.#flatPause !== undefined) {
      if (remaining > 0) return 0;
      this.#gate.pause(this.#flatPause);
      return this.#flatPause;
    }

    const capacity = this.#capacity();

    if (this.#smooth) {
      if (capacity === undefined) return 0;
      this.#refill(capacity);
      // Заголовок только опускает оценку: большое `remaining` в начале окна не значит,
      // что столько же можно потратить прямо сейчас. Вверх её двигает лишь `#refill`,
      // по мере того как сервер действительно возвращает квоту.
      if (remaining < this.#tokens) this.#tokens = remaining;
      return this.#armPause(capacity);
    }

    if (remaining > 0) return 0;

    // Нижняя оценка ожидания: столько нужно серверу, чтобы вернуть одну единицу квоты,
    // если он возвращает её линейно. Граница окна из ответа не выводится, поэтому ждать
    // может потребоваться дольше — оставшийся путь доделает лестница `retryDelays`.
    const wait =
      capacity === undefined
        ? UNKNOWN_CAPACITY_PAUSE
        : Math.ceil(RATE_LIMIT_WINDOW / Math.max(capacity, 1));
    this.#gate.pause(wait);
    return wait;
  }

  /** Придерживает бакет на названное время — путь ответа `429`. Оценка остатка обнуляется. */
  pause(ms: number): void {
    if (this.#smooth) {
      this.#tokens = 0;
      this.#tokensAt = this.#clock.now();
    }
    this.#gate.pause(ms);
  }

  /** Снимок для `rateLimitState()`. */
  state(): RateLimitBucketState {
    return {
      destination: this.#destination,
      bucket: this.#bucket,
      limit: this.#limit,
      remaining: this.#remaining,
      active: this.#gate.active,
      pending: this.#gate.pending,
    };
  }

  /**
   * Останавливает уровень бакета. Общая очередь направления гасится пулом.
   *
   */
  stop(): void {
    this.#generation += 1;
    this.#gate.stop();
  }

  /** Лимит бакета: сказанный сервером, иначе табличный. */
  #capacity(): number | undefined {
    return this.#limit ?? this.#seedLimit;
  }

  /** Списывает токен на уходящий запрос и придерживает бакет до следующего. */
  #spend(): void {
    const capacity = this.#capacity();
    if (capacity === undefined) return;

    this.#refill(capacity);
    this.#tokens -= 1;
    this.#armPause(capacity);
  }

  /** Возвращает накопленное с прошлой проверки: `limit` единиц за минуту. */
  #refill(capacity: number): void {
    const now = this.#clock.now();
    if (this.#tokensAt !== undefined) {
      const restored = ((now - this.#tokensAt) * capacity) / RATE_LIMIT_WINDOW;
      this.#tokens = Math.min(capacity, this.#tokens + restored);
    }
    this.#tokensAt = now;
  }

  /** Держит бакет, пока не накопится хотя бы один токен. */
  #armPause(capacity: number): number {
    if (this.#tokens >= 1) return 0;

    const wait = Math.ceil(((1 - this.#tokens) * RATE_LIMIT_WINDOW) / capacity);
    this.#gate.pause(wait);
    return wait;
  }
}

/** Лимит бакета до первого ответа: поправка пользователя важнее табличного значения. */
function seedLimit(bucket: string, options: ResolvedRateLimitOptions): number | undefined {
  const override = options.bucketOverrides[bucket]?.limit;
  if (override !== undefined) return override;
  return isKnownBucket(bucket) ? BUCKET_LIMITS[bucket] : undefined;
}

/** Общая очередь направления и надстроенные над ней очереди его бакетов. */
interface DestinationQueues {
  shared: RequestQueue;
  buckets: Map<string, BucketQueue>;
}

/**
 * Очереди по парам «направление — серверный счётчик частоты».
 *
 * Направление — origin уже разрешённого URL: разные локальные имена одного хоста делят
 * лимит, а запрос с разовым внешним `baseUrl` не попадает в основную очередь. Мощность
 * карты ограничена каталогом операций, поэтому ни TTL, ни вытеснение не нужны.
 *
 * @internal
 */
export class RequestQueuePool {
  readonly #options: ResolvedRateLimitOptions;
  readonly #clock: ItdClock;
  /** Ключ `undefined` — основная очередь внутренних клиентов без известного направления. */
  readonly #destinations = new Map<string | undefined, DestinationQueues>();

  constructor(options: ResolvedRateLimitOptions, clock: ItdClock = systemClock) {
    this.#options = options;
    this.#clock = clock;
  }

  /** Очередь бакета на направлении. При `buckets: false` бакет всегда `default`. */
  for(destination: string | undefined, bucket: string = DEFAULT_RATE_LIMIT_BUCKET): BucketQueue {
    const name = this.#options.buckets ? bucket : DEFAULT_RATE_LIMIT_BUCKET;

    let entry = this.#destinations.get(destination);
    if (!entry) {
      entry = {
        shared: new RequestQueue(this.#options, this.#clock),
        buckets: new Map(),
      };
      this.#destinations.set(destination, entry);
    }

    let queue = entry.buckets.get(name);
    if (!queue) {
      queue = new BucketQueue(destination, name, entry.shared, this.#options, this.#clock);
      entry.buckets.set(name, queue);
    }
    return queue;
  }

  /** Снимки всех бакетов, о которых что-то известно. */
  states(): RateLimitBucketState[] {
    const states: RateLimitBucketState[] = [];
    for (const entry of this.#destinations.values()) {
      for (const queue of entry.buckets.values()) states.push(queue.state());
    }
    return states;
  }

  /**
   * Останавливает оба уровня всех очередей: ожидающие задачи отклоняются, а состояние
   * счётчиков и отложенные паузы сохраняются до следующего запуска — путь `close()`.
   */
  stop(): void {
    for (const entry of this.#destinations.values()) {
      for (const queue of entry.buckets.values()) queue.stop();
      entry.shared.stop();
    }
  }

  /** Останавливает очереди и забывает всё, что известно о счётчиках, — путь `dispose()`. */
  clear(): void {
    this.stop();
    this.#destinations.clear();
  }
}
