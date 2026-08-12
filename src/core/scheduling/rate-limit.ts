import { type ItdClock, systemClock } from '../clock.js';
import type { ResolvedRateLimitOptions } from '../config.js';
import { ItdAbortError, ItdConfigError } from '../errors.js';
import type { RateLimitBucketOverride } from '../options.js';
import { RateLimitPacing } from './pacing.js';

/** Ошибка отмены запроса, который ещё не дошёл до транспорта. */
function queueAbortError(): ItdAbortError {
  return new ItdAbortError('Запрос отменён во время ожидания очереди');
}

/** Ошибка запроса, которого застала остановка очереди. */
function queueStoppedError(): ItdAbortError {
  return new ItdAbortError('Клиент закрыт, запрос отменён');
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
 * Единый планировщик одного направления.
 *
 * Он выбирает готовый бакет и только перед фактическим запуском атомарно занимает общий
 * и локальный слоты. Одно ближайшее пробуждение обслуживает все бакеты направления.
 */
class DestinationScheduler {
  readonly #concurrency: number;
  readonly #minGap: number;
  readonly #clock: ItdClock;
  readonly #buckets: BucketQueue[] = [];
  #active = 0;
  #nextSlot = 0;
  #cursor = 0;
  #cancelTimer: (() => void) | undefined;
  #wakeupAt: number | undefined;

  constructor(options: ResolvedRateLimitOptions, clock: ItdClock) {
    this.#concurrency = options.concurrency;
    this.#minGap = options.rps ? 1000 / options.rps : 0;
    this.#clock = clock;
  }

  register(bucket: BucketQueue): void {
    this.#buckets.push(bucket);
  }

  /** Пересчитывает ближайший запуск после изменения очереди или ограничения. */
  changed(): void {
    this.#drain();
  }

  /** Перепланирует пробуждение после изменения времени готовности бакета. */
  timingChanged(): void {
    this.#cancelWakeup();
    this.#drain();
  }

  /** Отклоняет ожидающие задачи, сохраняя паузы и темп для повторного запуска клиента. */
  stop(): void {
    this.#cancelWakeup();
    for (const bucket of this.#buckets) bucket.cancelWaiting(queueStoppedError(), false);
  }

  #drain(): void {
    if (this.#active >= this.#concurrency) return;

    const now = this.#clock.now();
    let selected: BucketQueue | undefined;
    let selectedIndex = -1;
    let earliest = Number.POSITIVE_INFINITY;

    for (let offset = 0; offset < this.#buckets.length; offset += 1) {
      const index = (this.#cursor + offset) % this.#buckets.length;
      const bucket = this.#buckets[index];
      if (!bucket?.canStart) continue;

      const readyAt = Math.max(this.#nextSlot, bucket.readyAt);
      if (readyAt < earliest) earliest = readyAt;
      if (readyAt <= now) {
        selected = bucket;
        selectedIndex = index;
        break;
      }
    }

    if (!selected) {
      if (Number.isFinite(earliest)) this.#armWakeup(Math.max(0, earliest - now));
      else this.#cancelWakeup();
      return;
    }

    this.#cursor = (selectedIndex + 1) % this.#buckets.length;
    this.#active += 1;
    if (this.#minGap > 0) this.#nextSlot = now + this.#minGap;
    selected.dispatch(now, () => {
      this.#active -= 1;
      this.changed();
    });

    this.#drain();
  }

  #armWakeup(delay: number): void {
    const wakeupAt = this.#clock.now() + delay;
    if (this.#cancelTimer && (this.#wakeupAt ?? Number.POSITIVE_INFINITY) <= wakeupAt) return;
    this.#cancelWakeup();
    this.#wakeupAt = wakeupAt;
    this.#cancelTimer = this.#clock.schedule(() => {
      this.#cancelTimer = undefined;
      this.#wakeupAt = undefined;
      this.#drain();
    }, delay);
  }

  #cancelWakeup(): void {
    this.#cancelTimer?.();
    this.#cancelTimer = undefined;
    this.#wakeupAt = undefined;
  }
}

/** Задача, ожидающая окончательного запуска планировщиком направления. */
interface BucketTask {
  start: (complete: () => void) => void;
  cancel: (reason: unknown) => void;
}

/**
 * Состояние и очередь одного серверного бакета.
 *
 * Класс хранит локальную конкурентность, темп и серверную квоту, а решение о старте
 * делегирует общему планировщику направления.
 *
 * @internal
 */
export class BucketQueue {
  readonly #destination: string | undefined;
  readonly #bucket: string;
  readonly #scheduler: DestinationScheduler;
  readonly #clock: ItdClock;
  readonly #pacing: RateLimitPacing;
  readonly #concurrency: number;
  readonly #minGap: number;
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
  #active = 0;
  #nextSlot = 0;
  readonly #waiting: BucketTask[] = [];

  /**
   * Оценка остатка для режима `smooth`.
   *
   * Начинается с единицы, а не с полной ёмкости: где сейчас граница минутного окна,
   * из ответа не вывести, и считать бакет нетронутым нельзя.
   */
  #tokens = 1;
  #tokensAt: number | undefined;
  constructor(
    destination: string | undefined,
    bucket: string,
    scheduler: DestinationScheduler,
    options: ResolvedRateLimitOptions,
    clock: ItdClock,
    featureDefinition?: RateLimitBucketOverride,
  ) {
    this.#destination = destination;
    this.#bucket = bucket;
    this.#scheduler = scheduler;
    this.#clock = clock;
    this.#pacing = options.pacing;
    this.#smooth = options.buckets && options.pacing === RateLimitPacing.Smooth;
    this.#flatPause = options.buckets ? undefined : (options.retryDelays[0] ?? 0);
    this.#seedLimit = options.buckets
      ? (featureDefinition?.limit ?? seedLimit(bucket, options))
      : undefined;
    this.#concurrency = options.buckets
      ? (featureDefinition?.concurrency ??
        options.bucketOverrides[bucket]?.concurrency ??
        options.bucketConcurrency)
      : options.concurrency;
    const rps = options.buckets
      ? (featureDefinition?.rps ?? options.bucketOverrides[bucket]?.rps)
      : undefined;
    this.#minGap = rps ? 1000 / rps : 0;
    scheduler.register(this);
  }

  /** Имя счётчика. При `buckets: false` — всегда `default`, каким бы ни был запрос. */
  get bucket(): string {
    return this.#bucket;
  }

  /** Запросов бакета прошло в общую очередь и ещё не завершилось. */
  get active(): number {
    return this.#active;
  }

  /** Запросов бакета ждёт своей очереди. */
  get pending(): number {
    return this.#waiting.length;
  }

  /** Есть ли ожидающая задача, для которой свободен локальный слот. */
  get canStart(): boolean {
    return this.#waiting.length > 0 && this.#active < this.#concurrency;
  }

  /** Момент, раньше которого локальное ограничение не разрешает следующий старт. */
  get readyAt(): number {
    return this.#nextSlot;
  }

  /** Ставит запрос в очередь единого планировщика направления. */
  schedule<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) return Promise.reject(queueAbortError());

    return new Promise<T>((resolve, reject) => {
      let queued: BucketTask;
      const detach = () => signal?.removeEventListener('abort', onAbort);
      const onAbort = () => {
        const index = this.#waiting.indexOf(queued);
        if (index < 0) return;
        this.#waiting.splice(index, 1);
        queued.cancel(queueAbortError());
        this.#scheduler.timingChanged();
      };

      queued = {
        start: (complete) => {
          detach();
          Promise.resolve().then(task).then(resolve, reject).finally(complete);
        },
        cancel: (reason) => {
          detach();
          reject(reason);
        },
      };

      this.#waiting.push(queued);
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) onAbort();
      else this.#scheduler.changed();
    });
  }

  /** Запускает первую задачу; вызывается только планировщиком направления. */
  dispatch(now: number, complete: () => void): void {
    const task = this.#waiting.shift();
    if (!task) {
      complete();
      return;
    }

    this.#active += 1;
    if (this.#smooth) this.#spend();
    if (this.#minGap > 0) this.#nextSlot = Math.max(this.#nextSlot, now + this.#minGap);
    task.start(() => {
      this.#active -= 1;
      complete();
    });
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
      this.#hold(this.#flatPause);
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
      const wait = this.#armPause(capacity);
      this.#scheduler.timingChanged();
      return wait;
    }

    if (remaining > 0) return 0;

    // Нижняя оценка ожидания: столько нужно серверу, чтобы вернуть одну единицу квоты,
    // если он возвращает её линейно. Граница окна из ответа не выводится, поэтому ждать
    // может потребоваться дольше — оставшийся путь доделает лестница `retryDelays`.
    const wait =
      capacity === undefined
        ? UNKNOWN_CAPACITY_PAUSE
        : Math.ceil(RATE_LIMIT_WINDOW / Math.max(capacity, 1));
    this.#hold(wait);
    return wait;
  }

  /** Придерживает бакет на названное время — путь ответа `429`. Оценка остатка обнуляется. */
  pause(ms: number): void {
    if (this.#smooth) {
      this.#tokens = 0;
      this.#tokensAt = this.#clock.now();
    }
    this.#hold(ms);
  }

  /** Снимок для `rateLimitState()`. */
  state(): RateLimitBucketState {
    return {
      destination: this.#destination,
      bucket: this.#bucket,
      limit: this.#limit,
      remaining: this.#remaining,
      active: this.#active,
      pending: this.#waiting.length,
    };
  }

  /** Отклоняет ещё не начатые задачи этого бакета. */
  stop(): void {
    this.cancelWaiting(queueStoppedError());
  }

  /** Отклоняет ожидающие задачи; используется также при остановке всего направления. */
  cancelWaiting(reason: unknown, notify = true): void {
    const pending = this.#waiting.splice(0, this.#waiting.length);
    for (const task of pending) task.cancel(reason);
    if (notify) this.#scheduler.timingChanged();
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
    this.#nextSlot = Math.max(this.#nextSlot, this.#clock.now() + wait);
    return wait;
  }

  /** Отодвигает ближайший допустимый старт и перепланирует общее пробуждение. */
  #hold(ms: number): void {
    if (ms <= 0) return;
    this.#nextSlot = Math.max(this.#nextSlot, this.#clock.now() + ms);
    this.#scheduler.timingChanged();
  }
}

/** Лимит бакета до первого ответа: поправка пользователя важнее табличного значения. */
function seedLimit(bucket: string, options: ResolvedRateLimitOptions): number | undefined {
  const override = options.bucketOverrides[bucket]?.limit;
  if (override !== undefined) return override;
  return options.bucketLimits[bucket];
}

/** Планировщик направления и зарегистрированные в нём бакеты. */
interface DestinationQueues {
  scheduler: DestinationScheduler;
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
  /** Динамические определения feature вместе с числом использующих их клиентов. */
  readonly #featureBuckets = new Map<
    string,
    { definition: Readonly<RateLimitBucketOverride>; references: number }
  >();

  constructor(options: ResolvedRateLimitOptions, clock: ItdClock = systemClock) {
    this.#options = options;
    this.#clock = clock;
  }

  /**
   * Регистрирует бакет подключаемого feature.
   *
   * Повтор той же декларации разрешён клиентам, разделяющим один pool через `ItdAccounts`.
   * Возвращённая функция откатывает регистрацию, пока очередь бакета ещё не создана.
   */
  defineBucket(name: string, definition: RateLimitBucketOverride): () => void {
    const normalized = Object.freeze({
      ...(definition.limit === undefined ? {} : { limit: definition.limit }),
      ...(definition.concurrency === undefined ? {} : { concurrency: definition.concurrency }),
      ...(definition.rps === undefined ? {} : { rps: definition.rps }),
    });
    const existing = this.#featureBuckets.get(name);
    if (existing) {
      if (
        existing.definition.limit !== normalized.limit ||
        existing.definition.concurrency !== normalized.concurrency ||
        existing.definition.rps !== normalized.rps
      ) {
        throw new ItdConfigError(
          `Бакет feature «${name}» уже зарегистрирован с другими ограничениями`,
        );
      }
      existing.references += 1;
    } else {
      this.#featureBuckets.set(name, { definition: normalized, references: 1 });
    }

    let released = false;
    return () => {
      if (released) return;
      released = true;
      const current = this.#featureBuckets.get(name);
      if (!current) return;
      current.references -= 1;
      if (current.references > 0) return;
      const hasQueue = [...this.#destinations.values()].some((entry) => entry.buckets.has(name));
      if (!hasQueue) this.#featureBuckets.delete(name);
    };
  }

  /** Очередь бакета на направлении. При `buckets: false` бакет всегда `default`. */
  for(destination: string | undefined, bucket?: string): BucketQueue {
    const fallback = this.#options.defaultBucket;
    const name = this.#options.buckets ? (bucket ?? fallback) : fallback;

    let entry = this.#destinations.get(destination);
    if (!entry) {
      entry = {
        scheduler: new DestinationScheduler(this.#options, this.#clock),
        buckets: new Map(),
      };
      this.#destinations.set(destination, entry);
    }

    let queue = entry.buckets.get(name);
    if (!queue) {
      queue = new BucketQueue(
        destination,
        name,
        entry.scheduler,
        this.#options,
        this.#clock,
        this.#featureBuckets.get(name)?.definition,
      );
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
   * Останавливает планировщики: ожидающие задачи отклоняются, а состояние счётчиков
   * и отложенные паузы сохраняются до следующего запуска — путь `close()`.
   */
  stop(): void {
    for (const entry of this.#destinations.values()) {
      entry.scheduler.stop();
    }
  }

  /** Останавливает очереди и забывает всё, что известно о счётчиках, — путь `dispose()`. */
  clear(): void {
    this.stop();
    this.#destinations.clear();
    this.#featureBuckets.clear();
  }
}
