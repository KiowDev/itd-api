import { ItdConfigError } from '../core/errors.js';
import { createDeviceId } from '../core/runtime.js';
import { InteractionType, type ViewReason, type ViewSource } from '../types/enums.js';
import type { RequestOptions } from '../types/options.js';
import { BaseResource } from './base.js';

/** Параметры событий телеметрии. */
export interface TelemetryOptions {
  /** Переопределяет идентификатор сессии телеметрии (`sid`) для этого запроса. */
  sid?: string;
}

/** Часы, используемые tracker-ом для измерения времени просмотра. */
export interface TelemetryClock {
  /** Возвращает текущее время в миллисекундах. */
  now(): number;
}

/** Опции tracker-а просмотра. */
export interface ViewTrackerOptions extends TelemetryOptions {
  /** Часы для измерения времени. По умолчанию используется `Date.now()`. */
  clock?: TelemetryClock;
}

/** Опции накопителя телеметрии. */
export interface TelemetryBatchOptions extends TelemetryOptions {
  /**
   * Максимальное число событий в одном запросе.
   *
   * Значение по умолчанию — 50. Это размер клиентской пачки, а не заявленный лимит API.
   */
  maxBatchSize?: number;
  /** Часы для tracker-ов, созданных через накопитель. */
  clock?: TelemetryClock;
}

/** Событие просмотра поста для {@link TelemetryResource.dwell}. */
export interface DwellEntry {
  /** Метка показа — поле `vs` объекта поста. */
  vs: string;
  /** Время появления поста в зоне видимости, epoch-мс. */
  enterAt: number;
  /** Время ухода из зоны видимости, epoch-мс. */
  exitAt: number;
  /** Причина завершения просмотра. */
  reason: ViewReason;
  /** Длительность просмотра в мс. По умолчанию `exitAt - enterAt`. */
  durationMs?: number;
  /** Контекст источника показа. */
  sourceContext?: string;
  /** Источник показа. */
  source?: ViewSource;
  /** Пост уже встречался в этой сессии. */
  repeat?: boolean;
}

/** Событие взаимодействия с контентом для {@link TelemetryResource.interaction}. */
export interface InteractionEntry {
  /** Тип взаимодействия. */
  type: InteractionType;
  /** Метка показа — поле `vs` объекта поста. */
  vs: string;
  /** Идентификатор поста. */
  postId: string;
  /** Индекс вложения, начиная с нуля. */
  mediaIndex?: number;
  /** Источник показа. */
  source?: ViewSource;
  /** Просмотренная позиция видео в мс. */
  positionMs?: number;
  /** Длительность видео в мс. */
  durationMs?: number;
}

/** Данные для {@link TelemetryResource.startView}. */
export interface ViewTrackerInput {
  /** Метка показа — поле `vs` объекта поста. */
  vs: string;
  /** Контекст источника показа. */
  sourceContext?: string;
  /** Источник показа. */
  source?: ViewSource;
  /** Пост уже встречался в этой сессии. */
  repeat?: boolean;
}

/** Данные открытия фотографии. */
export interface PhotoOpenInput {
  /** Метка показа — поле `vs` объекта поста. */
  vs: string;
  /** Идентификатор поста. */
  postId: string;
  /** Индекс открытого вложения, начиная с нуля. */
  mediaIndex: number;
  /** Источник показа. */
  source?: ViewSource;
}

/** Данные о прогрессе просмотра видео. */
export interface VideoProgressInput {
  /** Метка показа — поле `vs` объекта поста. */
  vs: string;
  /** Идентификатор поста. */
  postId: string;
  /** Просмотренная позиция видео в мс. */
  positionMs: number;
  /** Длительность видео в мс. */
  durationMs: number;
  /** Источник показа. */
  source?: ViewSource;
}

/** Активное измерение времени просмотра. */
export interface ViewTracker {
  /** Время начала измерения в миллисекундах. */
  readonly enteredAt: number;
  /** Был ли уже вызван {@link finish}. */
  readonly finished: boolean;
  /**
   * Завершает измерение и передаёт событие.
   *
   * Повторный вызов возвращает тот же Promise и не создаёт второе событие.
   */
  finish(reason: ViewReason): Promise<void>;
}

/** Явно управляемый накопитель событий телеметрии. */
export interface TelemetryBatch {
  /** Число ожидающих событий просмотра. */
  readonly pendingDwell: number;
  /** Число ожидающих событий взаимодействия. */
  readonly pendingInteractions: number;
  /** Закрыт ли накопитель. */
  readonly closed: boolean;
  /** Добавляет одно или несколько событий просмотра. */
  dwell(entry: DwellEntry | readonly DwellEntry[]): this;
  /** Добавляет одно или несколько событий взаимодействия. */
  interaction(entry: InteractionEntry | readonly InteractionEntry[]): this;
  /** Добавляет событие открытия фотографии. */
  photoOpen(input: PhotoOpenInput): this;
  /** Добавляет событие прогресса просмотра видео. */
  videoProgress(input: VideoProgressInput): this;
  /** Начинает измерение просмотра, которое после `finish()` попадёт в этот накопитель. */
  startView(input: ViewTrackerInput): ViewTracker;
  /**
   * Отправляет накопленные события.
   *
   * Опции позволяют заменить, например, отменённый `signal` при повторной попытке.
   */
  flush(options?: RequestOptions): Promise<void>;
  /** Отправляет накопленные события и закрывает накопитель. */
  close(): Promise<void>;
}

const DEFAULT_BATCH_SIZE = 50;
const SYSTEM_CLOCK: TelemetryClock = Object.freeze({ now: () => Date.now() });

function assertNonEmpty(value: string, name: string): void {
  if (value.trim().length === 0) throw new ItdConfigError(`${name} должен быть непустой строкой`);
}

function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new ItdConfigError(`${name} должен быть конечным числом`);
}

function assertNonNegative(value: number, name: string): void {
  assertFinite(value, name);
  if (value < 0) throw new ItdConfigError(`${name} должен быть неотрицательным числом`);
}

function validateDwell(entry: DwellEntry): DwellEntry {
  assertNonEmpty(entry.vs, 'vs');
  assertFinite(entry.enterAt, 'enterAt');
  assertFinite(entry.exitAt, 'exitAt');
  if (entry.exitAt < entry.enterAt) {
    throw new ItdConfigError('exitAt не может быть раньше enterAt');
  }
  if (entry.durationMs !== undefined) assertNonNegative(entry.durationMs, 'durationMs');
  return { ...entry };
}

function validateInteraction(entry: InteractionEntry): InteractionEntry {
  assertNonEmpty(entry.vs, 'vs');
  assertNonEmpty(entry.postId, 'postId');
  if (entry.mediaIndex !== undefined) {
    assertNonNegative(entry.mediaIndex, 'mediaIndex');
    if (!Number.isInteger(entry.mediaIndex)) {
      throw new ItdConfigError('mediaIndex должен быть целым числом');
    }
  }
  if (entry.positionMs !== undefined) assertNonNegative(entry.positionMs, 'positionMs');
  if (entry.durationMs !== undefined) assertNonNegative(entry.durationMs, 'durationMs');
  return { ...entry };
}

function photoOpenEntry(input: PhotoOpenInput): InteractionEntry {
  return validateInteraction({ type: InteractionType.PhotoOpen, ...input });
}

function videoProgressEntry(input: VideoProgressInput): InteractionEntry {
  return validateInteraction({ type: InteractionType.VideoProgress, ...input });
}

class ViewTrackerImpl implements ViewTracker {
  readonly enteredAt: number;
  readonly #clock: TelemetryClock;
  readonly #input: ViewTrackerInput;
  readonly #submit: (entry: DwellEntry) => Promise<void> | void;
  #result: Promise<void> | undefined;

  constructor(
    input: ViewTrackerInput,
    clock: TelemetryClock,
    submit: (entry: DwellEntry) => Promise<void> | void,
  ) {
    assertNonEmpty(input.vs, 'vs');
    this.enteredAt = clock.now();
    assertFinite(this.enteredAt, 'clock.now()');
    this.#input = { ...input };
    this.#clock = clock;
    this.#submit = submit;
  }

  get finished(): boolean {
    return this.#result !== undefined;
  }

  finish(reason: ViewReason): Promise<void> {
    if (this.#result) return this.#result;

    try {
      const exitAt = this.#clock.now();
      assertFinite(exitAt, 'clock.now()');
      if (exitAt < this.enteredAt) {
        throw new ItdConfigError('часы не могут вернуться назад во время измерения просмотра');
      }

      this.#result = Promise.resolve(
        this.#submit({
          ...this.#input,
          enterAt: this.enteredAt,
          exitAt,
          reason,
        }),
      );
    } catch (error) {
      this.#result = Promise.reject(error);
    }

    return this.#result;
  }
}

class TelemetryBatchImpl implements TelemetryBatch {
  readonly #resource: TelemetryResource;
  readonly #telemetryOptions: TelemetryOptions;
  readonly #requestOptions: RequestOptions;
  readonly #clock: TelemetryClock;
  readonly #maxBatchSize: number;
  readonly #onClose: () => void;
  readonly #dwell: DwellEntry[] = [];
  readonly #interactions: InteractionEntry[] = [];
  #state: 'open' | 'closing' | 'closed' = 'open';
  #flushPromise: Promise<void> | undefined;
  #closePromise: Promise<void> | undefined;

  constructor(
    resource: TelemetryResource,
    options: TelemetryBatchOptions,
    requestOptions: RequestOptions,
    onClose: () => void,
  ) {
    const {
      maxBatchSize = DEFAULT_BATCH_SIZE,
      clock = SYSTEM_CLOCK,
      ...telemetryOptions
    } = options;
    if (!Number.isInteger(maxBatchSize) || maxBatchSize < 1) {
      throw new ItdConfigError('maxBatchSize должен быть целым числом от 1');
    }
    this.#resource = resource;
    this.#telemetryOptions = telemetryOptions;
    this.#requestOptions = requestOptions;
    this.#clock = clock;
    this.#maxBatchSize = maxBatchSize;
    this.#onClose = onClose;
  }

  get pendingDwell(): number {
    return this.#dwell.length;
  }

  get pendingInteractions(): number {
    return this.#interactions.length;
  }

  get closed(): boolean {
    return this.#state === 'closed';
  }

  dwell(entry: DwellEntry | readonly DwellEntry[]): this {
    this.#assertOpen();
    const entries = Array.isArray(entry) ? entry : [entry];
    this.#dwell.push(...entries.map(validateDwell));
    return this;
  }

  interaction(entry: InteractionEntry | readonly InteractionEntry[]): this {
    this.#assertOpen();
    const entries = Array.isArray(entry) ? entry : [entry];
    this.#interactions.push(...entries.map(validateInteraction));
    return this;
  }

  photoOpen(input: PhotoOpenInput): this {
    return this.interaction(photoOpenEntry(input));
  }

  videoProgress(input: VideoProgressInput): this {
    return this.interaction(videoProgressEntry(input));
  }

  startView(input: ViewTrackerInput): ViewTracker {
    this.#assertOpen();
    return new ViewTrackerImpl(input, this.#clock, (entry) => {
      this.dwell(entry);
    });
  }

  flush(options: RequestOptions = {}): Promise<void> {
    if (this.#state === 'closed') return Promise.resolve();
    if (this.#flushPromise) return this.#flushPromise;

    const running = this.#flushAll({ ...this.#requestOptions, ...options });
    const tracked = running.finally(() => {
      if (this.#flushPromise === tracked) this.#flushPromise = undefined;
    });
    this.#flushPromise = tracked;
    return tracked;
  }

  close(): Promise<void> {
    if (this.#state === 'closed') return Promise.resolve();
    if (this.#closePromise) return this.#closePromise;

    this.#state = 'closing';
    const running = this.flush()
      .then(() => {
        this.#state = 'closed';
        this.#onClose();
      })
      .catch((error: unknown) => {
        this.#state = 'open';
        throw error;
      });
    const tracked = running.finally(() => {
      if (this.#closePromise === tracked) this.#closePromise = undefined;
    });
    this.#closePromise = tracked;
    return tracked;
  }

  async #flushAll(options: RequestOptions): Promise<void> {
    while (this.#dwell.length > 0) {
      const chunk = this.#dwell.splice(0, this.#maxBatchSize);
      try {
        await this.#resource.dwell(chunk, this.#telemetryOptions, options);
      } catch (error) {
        this.#dwell.unshift(...chunk);
        throw error;
      }
    }

    while (this.#interactions.length > 0) {
      const chunk = this.#interactions.splice(0, this.#maxBatchSize);
      try {
        await this.#resource.interaction(chunk, this.#telemetryOptions, options);
      } catch (error) {
        this.#interactions.unshift(...chunk);
        throw error;
      }
    }
  }

  #assertOpen(): void {
    if (this.#state !== 'open') {
      throw new ItdConfigError('накопитель телеметрии уже закрывается или закрыт');
    }
  }
}

/**
 * Телеметрия просмотров и взаимодействий.
 *
 * Ничего не отправляет автоматически: каждый запрос, tracker или накопитель создаётся
 * явным вызовом пользователя. Доступна как `itd.telemetry`.
 */
export class TelemetryResource extends BaseResource {
  #sessionId: string | undefined;
  readonly #batches = new Set<TelemetryBatchImpl>();

  /** Идентификатор сессии телеметрии, общий для всех событий этого ресурса. */
  get sessionId(): string {
    this.#sessionId ??= createDeviceId();
    return this.#sessionId;
  }

  /** Отправляет события просмотра постов (`POST /api/v1/i`). */
  dwell(
    entries: readonly DwellEntry[],
    telemetryOptions: TelemetryOptions = {},
    requestOptions: RequestOptions = {},
  ): Promise<unknown> {
    const validated = entries.map(validateDwell);
    return this.http.operation('telemetry.dwell', {
      path: '/api/v1/i',
      body: {
        sid: telemetryOptions.sid ?? this.sessionId,
        e: validated.map((entry) => ({
          md: entry.durationMs ?? entry.exitAt - entry.enterAt,
          et: entry.enterAt,
          xt: entry.exitAt,
          r: entry.reason,
          v: entry.vs,
          ...(entry.sourceContext !== undefined ? { sc: entry.sourceContext } : {}),
          ...(entry.source !== undefined ? { s: entry.source } : {}),
          ...(entry.repeat ? { b: 1 } : {}),
        })),
      },
      ...requestOptions,
    });
  }

  /** Отправляет события взаимодействия с контентом (`POST /api/v1/x`). */
  interaction(
    entries: readonly InteractionEntry[],
    telemetryOptions: TelemetryOptions = {},
    requestOptions: RequestOptions = {},
  ): Promise<unknown> {
    const validated = entries.map(validateInteraction);
    return this.http.operation('telemetry.interaction', {
      path: '/api/v1/x',
      body: {
        sid: telemetryOptions.sid ?? this.sessionId,
        e: validated.map((entry) => ({
          t: entry.type,
          v: entry.vs,
          ai: entry.postId,
          ...(entry.mediaIndex !== undefined ? { mi: entry.mediaIndex } : {}),
          ...(entry.source !== undefined ? { s: entry.source } : {}),
          ...(entry.positionMs !== undefined ? { pm: Math.round(entry.positionMs) } : {}),
          ...(entry.durationMs !== undefined ? { dm: Math.round(entry.durationMs) } : {}),
        })),
      },
      ...requestOptions,
    });
  }

  /** Начинает измерять время просмотра и отправляет результат после `finish()`. */
  startView(
    input: ViewTrackerInput,
    options: ViewTrackerOptions = {},
    requestOptions: RequestOptions = {},
  ): ViewTracker {
    const { clock = SYSTEM_CLOCK, ...telemetryOptions } = options;
    return new ViewTrackerImpl(input, clock, async (entry) => {
      await this.dwell([entry], telemetryOptions, requestOptions);
    });
  }

  /** Отправляет событие открытия фотографии. */
  photoOpen(
    input: PhotoOpenInput,
    telemetryOptions: TelemetryOptions = {},
    requestOptions: RequestOptions = {},
  ): Promise<unknown> {
    return this.interaction([photoOpenEntry(input)], telemetryOptions, requestOptions);
  }

  /** Отправляет событие прогресса просмотра видео. */
  videoProgress(
    input: VideoProgressInput,
    telemetryOptions: TelemetryOptions = {},
    requestOptions: RequestOptions = {},
  ): Promise<unknown> {
    return this.interaction([videoProgressEntry(input)], telemetryOptions, requestOptions);
  }

  /**
   * Создаёт накопитель с явными `flush()` и `close()`.
   *
   * Создание и добавление записей не выполняют сетевых запросов.
   */
  batch(options: TelemetryBatchOptions = {}, requestOptions: RequestOptions = {}): TelemetryBatch {
    let batch: TelemetryBatchImpl;
    batch = new TelemetryBatchImpl(this, options, requestOptions, () => {
      this.#batches.delete(batch);
    });
    this.#batches.add(batch);
    return batch;
  }

  /** Закрывает все созданные накопители, отправляя оставшиеся записи. */
  async close(): Promise<void> {
    const results = await Promise.allSettled([...this.#batches].map((batch) => batch.close()));
    const errors = results
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => result.reason);
    if (errors.length > 0) {
      throw new AggregateError(errors, 'Не удалось отправить накопленную телеметрию');
    }
  }
}
