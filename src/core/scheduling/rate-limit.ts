import type { RateLimitBucketDefinition } from '../catalog.js';
import { type ItdClock, systemClock } from '../clock.js';
import type { ResolvedRateLimitOptions } from '../config.js';
import { ItdAbortError, ItdConfigError } from '../errors.js';
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
const MAX_TIMER_DELAY = 2 ** 31 - 1;

/** Минимальный простой динамического бакета перед удалением. */
const BUCKET_IDLE_TTL = 5 * RATE_LIMIT_WINDOW;

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
  /** Ключ динамического экземпляра, например `chat:<id>`. */
  instance?: string | undefined;
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
  readonly #waiting = new Set<BucketQueue>();
  #active = 0;
  #nextSlot = 0;
  #cancelTimer: (() => void) | undefined;
  #wakeupAt: number | undefined;

  constructor(options: ResolvedRateLimitOptions, clock: ItdClock) {
    this.#concurrency = options.concurrency;
    this.#minGap = options.rps ? 1000 / options.rps : 0;
    this.#clock = clock;
  }

  /** Обновляет набор бакетов с ожидающими задачами и пересчитывает запуск. */
  changed(bucket: BucketQueue): void {
    if (bucket.pending > 0) this.#waiting.add(bucket);
    else this.#waiting.delete(bucket);
    this.#drain();
  }

  /** Откладывает новые запросы всех бакетов направления. */
  pause(ms: number): void {
    if (ms <= 0) return;
    this.#nextSlot = Math.max(this.#nextSlot, this.#clock.now() + ms);
    this.#drain();
  }

  /** Отклоняет ожидающие задачи, сохраняя паузы и темп для повторного запуска клиента. */
  stop(): void {
    this.#cancelWakeup();
    for (const bucket of this.#waiting) bucket.cancelWaiting(queueStoppedError(), false);
    this.#waiting.clear();
  }

  #drain(): void {
    while (this.#active < this.#concurrency && this.#waiting.size > 0) {
      const now = this.#clock.now();
      if (this.#nextSlot > now) {
        this.#armWakeup(this.#nextSlot - now);
        return;
      }

      let selected: BucketQueue | undefined;
      let earliest = Number.POSITIVE_INFINITY;

      for (const bucket of this.#waiting) {
        if (!bucket.canStart) continue;

        const readyAt = bucket.readyAt;
        if (readyAt < earliest) earliest = readyAt;
        if (readyAt <= now) {
          selected = bucket;
          break;
        }
      }

      if (!selected) {
        if (Number.isFinite(earliest)) this.#armWakeup(Math.max(0, earliest - now));
        else this.#cancelWakeup();
        return;
      }

      this.#waiting.delete(selected);
      this.#active += 1;
      if (this.#minGap > 0) this.#nextSlot = now + this.#minGap;
      selected.dispatch(now, () => {
        this.#active -= 1;
        this.#drain();
      });
      if (selected.pending > 0) this.#waiting.add(selected);
    }
    if (this.#waiting.size === 0) this.#cancelWakeup();
  }

  #armWakeup(delay: number): void {
    const wait = Math.min(delay, MAX_TIMER_DELAY);
    const wakeupAt = this.#clock.now() + wait;
    if (this.#cancelTimer && (this.#wakeupAt ?? Number.POSITIVE_INFINITY) <= wakeupAt) return;
    this.#cancelWakeup();
    this.#wakeupAt = wakeupAt;
    this.#cancelTimer = this.#clock.schedule(() => {
      this.#cancelTimer = undefined;
      this.#wakeupAt = undefined;
      this.#drain();
    }, wait);
  }

  #cancelWakeup(): void {
    this.#cancelTimer?.();
    this.#cancelTimer = undefined;
    this.#wakeupAt = undefined;
  }
}

/** Задача, ожидающая окончательного запуска планировщиком направления. */
interface BucketTask {
  cost: number;
  start: (complete: () => void) => void;
  cancel: (reason: unknown) => void;
}

/** Узел очереди ожидания. */
interface WaitingNode {
  readonly task: BucketTask;
  prev: WaitingNode | undefined;
  next: WaitingNode | undefined;
  /** Стоит ли узел в очереди; снятый узел повторно не снимается. */
  linked: boolean;
}

/**
 * Очередь ожидающих задач в порядке постановки.
 *
 * Постановка в хвост, снятие головы, снятие произвольного узла при отмене и полная
 * очистка — за O(1) при любой длине: очередь рассчитана на десятки тысяч задач, разом
 * упёршихся в паузу `429`.
 */
class WaitingList {
  #head: WaitingNode | undefined;
  #tail: WaitingNode | undefined;
  #size = 0;

  get size(): number {
    return this.#size;
  }

  push(task: BucketTask): WaitingNode {
    const node: WaitingNode = { task, prev: this.#tail, next: undefined, linked: true };
    if (this.#tail) this.#tail.next = node;
    else this.#head = node;
    this.#tail = node;
    this.#size += 1;
    return node;
  }

  shift(): BucketTask | undefined {
    const node = this.#head;
    if (!node) return undefined;
    this.remove(node);
    return node.task;
  }

  /** Снимает узел; `false`, если он уже снят. */
  remove(node: WaitingNode): boolean {
    if (!node.linked) return false;
    node.linked = false;
    if (node.prev) node.prev.next = node.next;
    else this.#head = node.next;
    if (node.next) node.next.prev = node.prev;
    else this.#tail = node.prev;
    node.prev = undefined;
    node.next = undefined;
    this.#size -= 1;
    return true;
  }

  /** Снимает все узлы; задачи возвращаются в порядке постановки. */
  drain(): BucketTask[] {
    const tasks: BucketTask[] = [];
    let node = this.#head;
    while (node) {
      const following = node.next;
      node.linked = false;
      node.prev = undefined;
      node.next = undefined;
      tasks.push(node.task);
      node = following;
    }
    this.#head = undefined;
    this.#tail = undefined;
    this.#size = 0;
    return tasks;
  }
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
  readonly #trackTokens: boolean;
  readonly #burst: number | undefined;
  #reportedBalance = false;
  #tokenSlot = 0;
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
  /** Верхняя граница накопленных токенов. */
  readonly #maxTokens: number;
  /** Начальные ограничения из каталога, с которыми создана очередь. */
  readonly #definition: Readonly<RateLimitBucketDefinition> | undefined;

  /** Последнее, что сказал сервер. Живёт и в режиме `off` — ради `rateLimitState()`. */
  #limit: number | undefined;
  #remaining: number | undefined;
  #active = 0;
  #nextSlot = 0;
  readonly #waiting = new WaitingList();

  /**
   * Локальная оценка остатка при включённом учёте токенов.
   *
   * В react начальный запас задаёт burst, в smooth первый запрос получает один токен.
   */
  #tokens = 1;
  #tokensAt: number | undefined;
  constructor(
    destination: string | undefined,
    bucket: string,
    scheduler: DestinationScheduler,
    options: ResolvedRateLimitOptions,
    clock: ItdClock,
    definition: Readonly<RateLimitBucketDefinition> | undefined,
  ) {
    this.#destination = destination;
    this.#bucket = bucket;
    this.#scheduler = scheduler;
    this.#clock = clock;
    this.#definition = definition;
    this.#pacing = options.pacing;
    this.#flatPause = options.buckets ? undefined : (options.retryDelays[0] ?? 0);
    // Поправка из настроек клиента важнее начального ограничения из каталога.
    const override = options.buckets ? options.bucketOverrides[bucket] : undefined;
    this.#seedLimit = options.buckets ? (override?.limit ?? definition?.limit) : undefined;
    this.#burst =
      options.buckets && this.#pacing === RateLimitPacing.React
        ? (override?.burst ?? definition?.burst)
        : undefined;
    this.#trackTokens =
      this.#burst !== undefined || (options.buckets && this.#pacing === RateLimitPacing.Smooth);
    this.#maxTokens = definition?.maxTokens ?? Number.POSITIVE_INFINITY;
    this.#tokens = this.#burst ?? 1;
    this.#concurrency = options.buckets
      ? (override?.concurrency ?? definition?.concurrency ?? options.bucketConcurrency)
      : options.concurrency;
    const rps = options.buckets ? (override?.rps ?? definition?.rps) : undefined;
    this.#minGap = rps ? 1000 / rps : 0;
  }

  /** Имя счётчика. При `buckets: false` — всегда `default`, каким бы ни был запрос. */
  get bucket(): string {
    return this.#bucket;
  }

  /** Начальные ограничения из каталога, с которыми создана очередь. */
  get definition(): Readonly<RateLimitBucketDefinition> | undefined {
    return this.#definition;
  }

  /** Запросов бакета прошло в общую очередь и ещё не завершилось. */
  get active(): number {
    return this.#active;
  }

  /** Запросов бакета ждёт своей очереди. */
  get pending(): number {
    return this.#waiting.size;
  }

  /** Есть ли ожидающая задача, для которой свободен локальный слот. */
  get canStart(): boolean {
    return this.#waiting.size > 0 && this.#active < this.#concurrency;
  }

  /** Момент, раньше которого локальное ограничение не разрешает следующий старт. */
  get readyAt(): number {
    return this.#reportedBalance ? this.#nextSlot : Math.max(this.#nextSlot, this.#tokenSlot);
  }

  get usesBurst(): boolean {
    return this.#burst !== undefined;
  }

  /** Проверяет, можно ли освободить очередь без потери паузы или невосполненной квоты. */
  canExpire(now: number): boolean {
    if (this.#active > 0 || this.#waiting.size > 0 || this.readyAt > now) return false;

    const capacity = this.#capacity();
    if (!this.#trackTokens || capacity === undefined || this.#tokensAt === undefined) return true;

    const restored = ((now - this.#tokensAt) * capacity) / RATE_LIMIT_WINDOW;
    return this.#tokens + restored >= (this.#burst ?? Math.min(capacity, this.#maxTokens));
  }

  /** Ставит запрос в очередь единого планировщика направления. */
  schedule<T>(task: () => Promise<T>, signal?: AbortSignal, cost = 1): Promise<T> {
    if (signal?.aborted) return Promise.reject(queueAbortError());

    return new Promise<T>((resolve, reject) => {
      let queued: WaitingNode;
      const detach = () => signal?.removeEventListener('abort', onAbort);
      const onAbort = () => {
        if (!this.#waiting.remove(queued)) return;
        queued.task.cancel(queueAbortError());
        this.#scheduler.changed(this);
      };

      queued = this.#waiting.push({
        cost,
        start: (complete) => {
          detach();
          Promise.resolve().then(task).then(resolve, reject).finally(complete);
        },
        cancel: (reason) => {
          detach();
          reject(reason);
        },
      });

      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) onAbort();
      else this.#scheduler.changed(this);
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
    if (this.#trackTokens) this.#spend(task.cost);
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
  observe(limit: number | undefined, remaining: number | undefined, pace = true): number {
    if (limit === undefined && remaining === undefined && !this.#reportedBalance) return 0;
    // Основной транспорт уже отбрасывает некорректный заголовок, но очередь остаётся
    // самостоятельным внутренним примитивом: не позволяем прямому вызову записать
    // нулевую ёмкость и получить бесконечный таймер в режиме smooth.
    let rateChanged = false;
    if (limit !== undefined && Number.isFinite(limit) && limit > 0) {
      const previous = this.#capacity();
      rateChanged = this.usesBurst && previous !== limit;
      if (rateChanged && previous !== undefined) this.#refill(previous);
      this.#limit = limit;
      if (rateChanged) this.#tokenSlot = this.#tokenReadyAt(this.#tokens, limit);
    }
    if (remaining !== undefined) this.#remaining = remaining;
    if (!pace || this.#pacing === RateLimitPacing.Off) return 0;

    if (this.#burst !== undefined) {
      const reported = limit !== undefined && remaining !== undefined;
      if (reported && this.#tokensAt !== undefined && this.#tokensAt > this.#clock.now()) return 0;
      if (reported) {
        this.#reportedBalance = true;
        this.#tokens = Math.min(this.#burst, remaining);
        this.#tokensAt = this.#clock.now();
        this.#tokenSlot = 0;
      } else if (this.#reportedBalance || rateChanged) {
        this.#reportedBalance = false;
        if (remaining === undefined) this.#scheduler.changed(this);
      }
    }
    if (remaining === undefined) return 0;

    if (this.#flatPause !== undefined) {
      if (remaining > 0) return 0;
      this.#hold(this.#flatPause);
      return this.#flatPause;
    }

    const capacity = this.#capacity();

    if (this.#trackTokens && !this.#reportedBalance) {
      if (capacity === undefined) return 0;
      this.#refill(capacity);
      // Заголовок только опускает оценку: большое `remaining` в начале окна не значит,
      // что столько же можно потратить прямо сейчас. Вверх её двигает лишь `#refill`,
      // по мере того как сервер действительно возвращает квоту.
      if (remaining < this.#tokens) this.#tokens = remaining;
      const wait = this.#armPause(capacity);
      this.#scheduler.changed(this);
      return wait;
    }

    if (remaining > 0) {
      if (this.#reportedBalance) this.#scheduler.changed(this);
      return 0;
    }

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

  /** После локального отказа первый разрешённый старт расходует начальный токен. */
  adaptAfterRejection(delay: number | undefined, rejectedCost = 0): void {
    const capacity = this.#capacity();
    if (this.#burst !== undefined && capacity !== undefined) {
      const now = this.#clock.now();
      // В срок сервера доступен первый токен; дальнейший простой пополняет запас.
      const firstTokenAt = Math.max(
        now + (delay ?? Math.ceil(RATE_LIMIT_WINDOW / capacity)),
        this.#tokensAt ?? 0,
        // Неуспешная попытка не расходует квоту. Сохраняем долг других запросов.
        this.#tokens < 0 ? this.#tokenReadyAt(this.#tokens + rejectedCost, capacity) : 0,
      );
      this.#reportedBalance = false;
      this.#tokens = 1;
      this.#tokensAt = firstTokenAt;
      this.#tokenSlot = firstTokenAt;
      this.#hold(firstTokenAt - now);
    } else if (delay !== undefined) {
      this.pause(delay);
    }
  }

  /** Придерживает бакет на названное время — путь ответа `429`. */
  pause(ms: number): void {
    if (this.#trackTokens && this.#pacing === RateLimitPacing.Smooth) {
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
      pending: this.#waiting.size,
    };
  }

  /** Отклоняет ещё не начатые задачи этого бакета. */
  stop(): void {
    this.cancelWaiting(queueStoppedError());
  }

  /** Отклоняет ожидающие задачи; используется также при остановке всего направления. */
  cancelWaiting(reason: unknown, notify = true): void {
    for (const task of this.#waiting.drain()) task.cancel(reason);
    if (notify) this.#scheduler.changed(this);
  }

  /** Лимит бакета: сказанный сервером, иначе табличный. */
  #capacity(): number | undefined {
    return this.#limit ?? this.#seedLimit;
  }

  /** Списывает стоимость уходящего запроса и обновляет время следующего старта. */
  #spend(cost: number): void {
    const capacity = this.#capacity();
    if (capacity === undefined) return;

    this.#refill(capacity);
    this.#tokens -= cost;
    this.#armPause(capacity);
  }

  /** Возвращает накопленное с прошлой проверки: `limit` единиц за минуту. */
  #refill(capacity: number): void {
    const now = this.#clock.now();
    if (this.#tokensAt !== undefined) {
      if (now < this.#tokensAt) return;
      const restored = ((now - this.#tokensAt) * capacity) / RATE_LIMIT_WINDOW;
      this.#tokens = Math.min(
        this.#burst ?? Math.min(capacity, this.#maxTokens),
        this.#tokens + restored,
      );
    }
    this.#tokensAt = now;
  }

  /** Срок восстановления первого токена из остатка на момент последнего учёта. */
  #tokenReadyAt(balance: number, capacity: number): number {
    if (balance >= 1 || this.#tokensAt === undefined) return 0;
    return this.#tokensAt + Math.ceil(((1 - balance) * RATE_LIMIT_WINDOW) / capacity);
  }

  /** Держит бакет, пока не накопится хотя бы один токен. */
  #armPause(capacity: number): number {
    const readyAt = this.#tokenReadyAt(this.#tokens, capacity);
    if (this.#burst !== undefined) this.#tokenSlot = readyAt;
    else this.#nextSlot = Math.max(this.#nextSlot, readyAt);
    return readyAt === 0 ? 0 : Math.max(0, readyAt - this.#clock.now());
  }

  /** Отодвигает ближайший допустимый старт и перепланирует общее пробуждение. */
  #hold(ms: number): void {
    if (ms <= 0) return;
    this.#nextSlot = Math.max(this.#nextSlot, this.#clock.now() + ms);
    this.#scheduler.changed(this);
  }
}

/** Совпадают ли настройки бакета из каталога. */
function sameDefinition(
  left: Readonly<RateLimitBucketDefinition> | undefined,
  right: Readonly<RateLimitBucketDefinition> | undefined,
): boolean {
  return (
    left?.limit === right?.limit &&
    left?.maxTokens === right?.maxTokens &&
    left?.burst === right?.burst &&
    left?.concurrency === right?.concurrency &&
    left?.rps === right?.rps
  );
}

/** Ограничения бакета для текста ошибки. */
function describeDefinition(definition: Readonly<RateLimitBucketDefinition> | undefined): string {
  const parts = [
    definition?.limit === undefined ? [] : [`limit ${definition.limit}`],
    definition?.maxTokens === undefined ? [] : [`maxTokens ${definition.maxTokens}`],
    definition?.concurrency === undefined ? [] : [`concurrency ${definition.concurrency}`],
    definition?.burst === undefined ? [] : [`burst ${definition.burst}`],
    definition?.rps === undefined ? [] : [`rps ${definition.rps}`],
  ].flat();
  return parts.length > 0 ? parts.join(', ') : 'без ограничений';
}

interface CachedBucket {
  queue: BucketQueue;
  dynamic?: {
    instance: string;
    owner: string | undefined;
    lastUsedAt: number;
  };
}

/** Планировщик направления и зарегистрированные в нём бакеты. */
interface DestinationQueues {
  scheduler: DestinationScheduler;
  buckets: Map<string, CachedBucket>;
  instances?: Map<string, CachedBucket>;
}

/**
 * Очереди по направлению, бакету и необязательному ключу его экземпляра.
 *
 * Направление — origin уже разрешённого URL: разные локальные имена одного хоста делят
 * лимит, а запрос с разовым внешним `baseUrl` не попадает в основную очередь.
 * Статические бакеты сохраняются до очистки пула. Динамические удаляются после простоя
 * при очередном обращении к динамическому бакету.
 *
 * @internal
 */
export class RequestQueuePool {
  readonly #options: ResolvedRateLimitOptions;
  readonly #clock: ItdClock;
  /** Ключ `undefined` — основная очередь внутренних клиентов без известного направления. */
  readonly #destinations = new Map<string | undefined, DestinationQueues>();
  #nextPruneAt: number | undefined;

  constructor(options: ResolvedRateLimitOptions, clock: ItdClock = systemClock) {
    this.#options = options;
    this.#clock = clock;
  }

  /**
   * Очередь экземпляра бакета на направлении. При `buckets: false` используется `default`.
   *
   * Начальные ограничения приходят из каталога вызывающего клиента и запоминаются при
   * создании очереди. Клиенты, разделяющие один пул через `ItdAccounts`, обязаны описывать
   * бакет одинаково: расхождение обнаруживается при обращении к уже созданной очереди.
   *
   * @throws {ItdConfigError} если очередь бакета создана с другими ограничениями
   */
  for(
    destination: string | undefined,
    bucket?: string,
    definition?: Readonly<RateLimitBucketDefinition>,
    instance?: string,
    owner?: string,
  ): BucketQueue {
    const fallback = this.#options.defaultBucket;
    const name = this.#options.buckets ? (bucket ?? fallback) : fallback;
    const limits = this.#options.buckets ? definition : undefined;
    const dynamic = this.#options.buckets ? instance || undefined : undefined;
    const now = dynamic ? this.#clock.now() : undefined;
    if (now !== undefined && this.#nextPruneAt !== undefined && now >= this.#nextPruneAt) {
      this.#prune(now);
    }

    const entry = this.#destination(destination);

    let buckets = entry.buckets;
    if (dynamic) {
      entry.instances ??= new Map();
      buckets = entry.instances;
    }
    const key = dynamic ? JSON.stringify([name, dynamic, owner]) : name;
    let cached = buckets.get(key);
    if (!cached) {
      cached = {
        queue: new BucketQueue(
          destination,
          name,
          entry.scheduler,
          this.#options,
          this.#clock,
          limits,
        ),
      };
      if (dynamic && now !== undefined) {
        cached.dynamic = { instance: dynamic, owner, lastUsedAt: now };
      }
      buckets.set(key, cached);
    } else if (!sameDefinition(cached.queue.definition, limits)) {
      throw new ItdConfigError(
        `Бакет «${name}» уже используется с другими ограничениями: ` +
          `${describeDefinition(cached.queue.definition)} против ${describeDefinition(limits)}`,
      );
    }
    if (cached.dynamic && now !== undefined) {
      cached.dynamic.lastUsedAt = now;
      this.#nextPruneAt ??= now + RATE_LIMIT_WINDOW;
    }
    return cached.queue;
  }

  /** Приостанавливает все очереди направления, включая созданные во время паузы. */
  pauseDestination(destination: string | undefined, ms: number): void {
    this.#destination(destination).scheduler.pause(ms);
  }

  #destination(destination: string | undefined): DestinationQueues {
    let entry = this.#destinations.get(destination);
    if (!entry) {
      entry = {
        scheduler: new DestinationScheduler(this.#options, this.#clock),
        buckets: new Map(),
      };
      this.#destinations.set(destination, entry);
    }
    return entry;
  }

  #prune(now: number): void {
    this.#nextPruneAt = undefined;
    for (const { instances } of this.#destinations.values()) {
      if (!instances) continue;
      for (const [key, { queue, dynamic }] of instances) {
        if (!dynamic) continue;
        if (now - dynamic.lastUsedAt >= BUCKET_IDLE_TTL && queue.canExpire(now)) {
          instances.delete(key);
        } else {
          this.#nextPruneAt ??= now + RATE_LIMIT_WINDOW;
        }
      }
    }
  }

  /** Снимки статических бакетов и динамических экземпляров указанного клиента. */
  states(owner?: string): RateLimitBucketState[] {
    const states: RateLimitBucketState[] = [];
    for (const entry of this.#destinations.values()) {
      for (const { queue } of entry.buckets.values()) states.push(queue.state());
      if (!entry.instances) continue;
      for (const { queue, dynamic } of entry.instances.values()) {
        if (dynamic && dynamic.owner === owner) {
          states.push({ ...queue.state(), instance: dynamic.instance });
        }
      }
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
    this.#nextPruneAt = undefined;
  }
}
