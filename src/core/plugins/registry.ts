import { createDeadline, type Deadline, type ItdClock } from '../clock.js';
import { ItdConfigError, ItdStateError } from '../errors.js';
import type { OperationRequestOptions } from '../options.js';
import { type RegisteredAttemptInterceptor, withAttemptInterceptorScope } from './attempts.js';
import type {
  AttemptInterceptor,
  ClientPlugin,
  OperationTransformer,
  PluginApi,
  PluginTeardown,
} from './contracts.js';
import {
  assertPluginRemovable,
  orderPluginDefinitions,
  validatePluginDefinition,
} from './order.js';

interface InstalledPlugin {
  plugin: ClientPlugin;
  transformers: OperationTransformer[];
  interceptors: AttemptInterceptor[];
  teardown: PluginTeardown | undefined;
  activeRequests: number;
  drain: Promise<void> | undefined;
  finishDrain: (() => void) | undefined;
}

/** Что реестру нужно знать об остановке. @internal */
export interface PluginRegistryOptions {
  /** Срок ожидания операций плагина при его отключении, мс. `0` — ждать без ограничения. */
  shutdownTimeout: number;
  clock: ItdClock;
}

/**
 * Список подключённых плагинов и зарегистрированных ими расширений.
 *
 * {@link run} собирает operation transformers вокруг одной логической операции и прикрепляет
 * к ней неизменяемый снимок attempt interceptors. Transport исполняет этот снимок отдельно
 * для каждой сетевой попытки. Порядок плагинов одинаков для обеих цепочек.
 *
 * @internal
 */
export class PluginRegistry {
  readonly #entries = new Map<string, InstalledPlugin>();
  readonly #removing = new Set<string>();
  readonly #cleanups = new Set<Promise<void>>();
  readonly #options: PluginRegistryOptions;
  #ordered: InstalledPlugin[] = [];

  constructor(options: PluginRegistryOptions) {
    this.#options = options;
  }

  /** Сколько плагинов подключено. */
  get size(): number {
    return this.#entries.size;
  }

  /** Имена плагинов в фактическом порядке выполнения. */
  names(): string[] {
    return this.#ordered.map(({ plugin }) => plugin.name);
  }

  /** Подключён ли плагин с таким именем. */
  has(name: string): boolean {
    return this.#entries.has(name);
  }

  /** Проверяет добавление без вызова `install()`. @internal */
  assertCanAdd(plugin: ClientPlugin): void {
    validatePluginDefinition(plugin);
    if (this.#removing.has(plugin.name)) {
      throw new ItdConfigError(
        `плагин «${plugin.name}» ещё отключается; дождитесь завершения unuse() или dispose()`,
      );
    }
    orderPluginDefinitions([...this.#ordered.map((entry) => entry.plugin), plugin]);
  }

  /** Проверяет удаление без изменения реестра. @internal */
  assertCanRemove(name: string): void {
    const entry = this.#entries.get(name);
    if (!entry) return;
    assertPluginRemovable(
      this.#ordered.map((current) => current.plugin),
      name,
    );
  }

  /**
   * Подключает плагин.
   *
   * `install()` выполняется синхронно. Каждая регистрация принадлежит установившему её
   * плагину и участвует в общем порядке `before`/`after`.
   *
   * @throws {ItdConfigError} если плагин задан неверно, уже подключён или нарушает зависимости
   */
  add(plugin: ClientPlugin, context: Omit<PluginApi, 'operations' | 'attempts'>): void {
    this.assertCanAdd(plugin);
    const ordered = orderPluginDefinitions([...this.#ordered.map((entry) => entry.plugin), plugin]);
    const transformers: OperationTransformer[] = [];
    const interceptors: AttemptInterceptor[] = [];
    const register = <T>(values: T[], value: T, kind: string): (() => void) => {
      if (typeof value !== 'function') {
        throw new ItdConfigError(`плагин «${plugin.name}» передал в ${kind}.use() не функцию`);
      }
      values.push(value);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        const index = values.indexOf(value);
        if (index >= 0) values.splice(index, 1);
      };
    };
    const installed = plugin.install({
      ...context,
      operations: {
        use: (transformer) => register(transformers, transformer, 'operations'),
      },
      attempts: {
        use: (interceptor) => register(interceptors, interceptor, 'attempts'),
      },
    });
    if (installed !== undefined && typeof installed !== 'function') {
      throw new ItdConfigError(
        `install() плагина «${plugin.name}» должен вернуть функцию или void`,
      );
    }
    const teardown = installed as PluginTeardown | undefined;

    this.#entries.set(plugin.name, {
      plugin,
      transformers,
      interceptors,
      teardown,
      activeRequests: 0,
      drain: undefined,
      finishDrain: undefined,
    });
    this.#ordered = ordered.map((definition) => {
      const entry = this.#entries.get(definition.name);
      if (!entry) throw new ItdConfigError(`плагин «${definition.name}» не установлен`);
      return entry;
    });
  }

  /**
   * Отключает плагин и вызывает его функцию очистки.
   *
   * Новые запросы перестают видеть расширения плагина сразу. Снимок уже начавшейся операции,
   * включая её будущие retry, остаётся неизменным; очистка дождётся завершения операции,
   * но не дольше отведённого срока.
   *
   * @returns `false`, если такого плагина не было
   * @throws {ItdStateError} если операции плагина не завершились за отведённый срок
   */
  async remove(name: string): Promise<boolean> {
    const entry = this.#entries.get(name);
    if (!entry) return false;
    this.assertCanRemove(name);
    this.#entries.delete(name);
    this.#ordered = this.#ordered.filter((current) => current !== entry);
    this.#removing.add(name);

    const deadline = createDeadline(this.#options.shutdownTimeout, this.#options.clock);
    const cleanup = this.#trackCleanup(
      (async () => {
        const expirationErrors = await this.#release(entry, deadline);
        if (expirationErrors.length === 1) throw expirationErrors[0];
        if (expirationErrors.length > 1) {
          throw new AggregateError(expirationErrors, `Не удалось отключить плагин «${name}»`);
        }
      })(),
    );
    try {
      await cleanup;
      return true;
    } finally {
      deadline.cancel();
      this.#removing.delete(name);
    }
  }

  /**
   * Отключает все плагины окончательно.
   *
   * Очистка идёт изнутри наружу — в порядке, обратном выполнению расширений. Срок ожидания
   * общий на все плагины.
   */
  async dispose(): Promise<void> {
    const entries = [...this.#ordered].reverse();
    const previousCleanups = [...this.#cleanups];
    this.#entries.clear();
    this.#ordered = [];
    for (const { plugin } of entries) this.#removing.add(plugin.name);

    const deadline = createDeadline(this.#options.shutdownTimeout, this.#options.clock);
    const cleanup = this.#trackCleanup(
      (async () => {
        const errors: unknown[] = [];
        const previous = await Promise.allSettled(previousCleanups);
        for (const result of previous) {
          if (result.status === 'rejected') errors.push(result.reason);
        }
        for (const entry of entries) {
          try {
            errors.push(...(await this.#release(entry, deadline)));
          } catch (error) {
            errors.push(error);
          } finally {
            this.#removing.delete(entry.plugin.name);
          }
        }
        if (errors.length > 0) {
          throw new AggregateError(errors, 'Не удалось освободить ресурсы плагинов');
        }
      })(),
    );
    try {
      await cleanup;
    } finally {
      deadline.cancel();
    }
  }

  /**
   * Прогоняет запрос через operation transformers и прикрепляет attempt interceptors.
   *
   * Снимки обеих цепочек берутся в начале: `unuse()` влияет на новые операции, но не меняет
   * уже выполняющуюся и не удаляет interceptors из её последующих retry.
   *
   * Каждый `next` одноразовый: transformer может завершить операцию сам, но не может породить
   * вторую — для `posts.create` это была бы вторая публикация.
   *
   * @param execute выполнение логической операции, вызываемое самым внутренним transformer
   */
  async run(
    request: OperationRequestOptions,
    execute: (request: OperationRequestOptions) => Promise<unknown>,
  ): Promise<unknown> {
    const entries = [...this.#ordered];
    for (const entry of entries) entry.activeRequests += 1;
    const interceptorScope: RegisteredAttemptInterceptor[] = entries.flatMap((entry) =>
      entry.interceptors.map((interceptor) => ({ plugin: entry.plugin.name, interceptor })),
    );
    const scoped = (current: OperationRequestOptions): OperationRequestOptions =>
      withAttemptInterceptorScope(current, interceptorScope);
    const chain = entries
      .flatMap((entry) =>
        entry.transformers.map((transformer) => ({ plugin: entry.plugin.name, transformer })),
      )
      .reduceRight<(request: OperationRequestOptions) => Promise<unknown>>(
        (next, { plugin, transformer }) =>
          (current) => {
            let called = false;
            return transformer(scoped(current), (prepared) => {
              if (called) {
                throw new ItdConfigError(
                  `operation transformer плагина «${plugin}» вызвал next() больше одного раза`,
                );
              }
              called = true;
              return next(scoped(prepared));
            });
          },
        (current) => execute(scoped(current)),
      );

    try {
      return await chain(scoped(request));
    } finally {
      for (const entry of entries) {
        entry.activeRequests -= 1;
        if (entry.activeRequests === 0) {
          entry.finishDrain?.();
          entry.finishDrain = undefined;
          entry.drain = undefined;
        }
      }
    }
  }

  /**
   * Дожидается операций плагина и освобождает его ресурсы.
   *
   * `teardown` запускается в любом случае, в том числе после истечения срока ожидания
   * операций, но его собственное ожидание также ограничено общим сроком.
   *
   * @returns ошибки истёкшего срока для незавершённых стадий
   */
  async #release(entry: InstalledPlugin, deadline: Deadline): Promise<ItdStateError[]> {
    const errors: ItdStateError[] = [];
    const operationsFinished = await deadline.wait(this.#waitForDrain(entry));
    if (!operationsFinished) {
      errors.push(
        new ItdStateError(
          `плагин «${entry.plugin.name}» не завершил операции за ${this.#options.shutdownTimeout} мс`,
        ),
      );
    }

    let teardownFailed = false;
    let teardownFailure: unknown;
    const teardown = Promise.resolve()
      .then(() => entry.teardown?.())
      .catch((error: unknown) => {
        teardownFailed = true;
        teardownFailure = error;
      });
    const teardownFinished = await deadline.wait(teardown);
    if (!teardownFinished) {
      errors.push(
        new ItdStateError(
          `плагин «${entry.plugin.name}» не завершил teardown за ${this.#options.shutdownTimeout} мс`,
        ),
      );
    } else if (teardownFailed) {
      throw teardownFailure;
    }

    return errors;
  }

  #waitForDrain(entry: InstalledPlugin): Promise<void> {
    if (entry.activeRequests === 0) return Promise.resolve();
    entry.drain ??= new Promise<void>((resolve) => {
      entry.finishDrain = resolve;
    });
    return entry.drain;
  }

  #trackCleanup(cleanup: Promise<void>): Promise<void> {
    this.#cleanups.add(cleanup);
    void cleanup.then(
      () => this.#cleanups.delete(cleanup),
      () => this.#cleanups.delete(cleanup),
    );
    return cleanup;
  }
}
