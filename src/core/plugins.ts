import type { Logger, RawRequestOptions } from '../types/options.js';
import { ItdConfigError } from './errors.js';

/**
 * Обёртка вокруг запроса.
 *
 * Получает описание запроса и продолжение цепочки. Может изменить запрос перед отправкой,
 * посмотреть и подменить разобранный ответ или вовсе не вызывать `next` и вернуть своё.
 *
 * @param request что уходит на сервер; изменять сам объект не нужно — передайте копию в `next`
 * @param next продолжение: либо следующая обёртка, либо настоящий запрос
 * @returns тело ответа в том виде, в каком его получит вызывающий код
 *
 * @example Дописать заголовок ко всем запросам
 * ```ts
 * const transformer: Transformer = (request, next) =>
 *   next({ ...request, headers: { ...request.headers, 'X-Trace': trace() } });
 * ```
 */
export type Transformer = (
  request: RawRequestOptions,
  next: (request: RawRequestOptions) => Promise<unknown>,
) => Promise<unknown>;

/** Что плагин получает при подключении. */
export interface PluginContext {
  /** Базовый URL клиента — например чтобы разобрать абсолютные ссылки из ответа. */
  baseUrl: string;
  /** Отладочный вывод клиента, если он включён. */
  logger: Logger | undefined;
  /** Добавляет обёртку запроса. Подключённые раньше оказываются снаружи. */
  use(transformer: Transformer): void;
}

/**
 * Плагин клиента.
 *
 * Подключается через `itd.use(plugin)` и работает на уровне транспорта: видит запрос
 * до отправки и разобранный ответ. Библиотека не знает, что именно делает плагин, —
 * ей достаточно списка обёрток и имён опций, которые он читает.
 *
 * @example
 * ```ts
 * const logging: ItdPlugin = {
 *   name: 'logging',
 *   install({ use, logger }) {
 *     use(async (request, next) => {
 *       logger?.info(`${request.method} ${request.path}`);
 *       return next(request);
 *     });
 *   },
 * };
 *
 * itd.use(logging);
 * ```
 */
export interface ItdPlugin {
  /** Имя плагина. Должно быть уникальным: повторное подключение — ошибка. */
  name: string;
  /**
   * Имена опций запроса, которые плагин читает у методов ресурсов.
   *
   * Библиотека этих опций не понимает и ничего с ними не делает — только доносит
   * от вызова метода до обёртки нетронутыми. Без такого списка чужие поля отсеиваются,
   * чтобы случайная опечатка в параметрах не уезжала на сервер.
   *
   * Имена полей самого запроса (`path`, `body`, `headers`, `signal` и прочие из
   * `RawRequestOptions`) заявить нельзя: подключение такого плагина завершится ошибкой.
   *
   * Типы для них плагин объявляет сам, дополняя `RequestOptions`:
   * ```ts
   * declare module 'itd-api' {
   *   interface RequestOptions { encrypt?: string | undefined }
   * }
   * ```
   */
  optionKeys?: readonly string[];
  /** Вызывается один раз при подключении. */
  install(context: PluginContext): void;
}

/** Пустой набор — отдаётся, пока плагинов нет, чтобы не заводить объект на каждый запрос. */
const NO_KEYS: ReadonlySet<string> = new Set<string>();

/**
 * Имена, которые плагин заявить не может.
 *
 * Заявленные опции ресурсы переносят в описание запроса поверх собранных полей, поэтому
 * имя из {@link RawRequestOptions} подменило бы путь, тело или заголовки любого вызова.
 */
const RESERVED_OPTION_KEYS: ReadonlySet<string> = new Set([
  'signal',
  'timeout',
  'headers',
  'retry',
  'method',
  'path',
  'service',
  'baseUrl',
  'query',
  'body',
  'skipAuth',
  'skipAuthRefresh',
  'skipQueue',
  'raw',
]);

/**
 * Проверяет описание плагина без его установки.
 *
 * Нужна не только {@link PluginRegistry}: контейнер аккаунтов обязан отклонять сломанный
 * плагин сразу, даже когда внутри ещё нет ни одного клиента, которому можно поручить
 * полноценную установку.
 *
 * @internal
 */
export function validatePluginDefinition(plugin: ItdPlugin): void {
  if (typeof plugin?.install !== 'function') {
    throw new ItdConfigError('Плагин должен быть объектом с методом install()');
  }

  const name = plugin.name;
  if (typeof name !== 'string' || name.trim() === '') {
    throw new ItdConfigError('У плагина должно быть непустое имя');
  }

  const keys = plugin.optionKeys ?? [];
  for (const key of keys) {
    if (typeof key !== 'string' || key.trim() === '') {
      throw new ItdConfigError(`Плагин «${name}» заявил пустое имя опции`);
    }
    if (RESERVED_OPTION_KEYS.has(key)) {
      throw new ItdConfigError(
        `Плагин «${name}» заявил опцию «${key}»: это поле запроса, имя занято. ` +
          `Занятые имена: ${[...RESERVED_OPTION_KEYS].join(', ')}`,
      );
    }
  }
}

/**
 * Список подключённых плагинов и собранная из них цепочка обёрток.
 *
 * Живёт в клиенте, а работает в транспорте: {@link HttpClient} прогоняет через `run`
 * каждый запрос, если плагины есть.
 */
export class PluginRegistry {
  readonly #transformers: Transformer[] = [];
  readonly #optionKeys = new Set<string>();
  readonly #names = new Set<string>();

  /** Сколько обёрток подключено. Ноль означает, что запрос идёт прежним путём. */
  get size(): number {
    return this.#transformers.length;
  }

  /** Имена опций запроса, заявленные плагинами. */
  get optionKeys(): ReadonlySet<string> {
    return this.#optionKeys.size === 0 ? NO_KEYS : this.#optionKeys;
  }

  /**
   * Подключает плагин.
   *
   * @throws {ItdConfigError} если плагин задан неверно, уже подключён или заявил занятое
   * имя опции
   */
  add(plugin: ItdPlugin, context: Omit<PluginContext, 'use'>): void {
    validatePluginDefinition(plugin);
    const name = plugin.name;

    // Повторное подключение почти всегда означает недосмотр, а последствия у него
    // молчаливые: обёртка отработает дважды — текст зашифруется два раза подряд.
    if (this.#names.has(name)) {
      throw new ItdConfigError(`Плагин «${name}» уже подключён`);
    }

    const keys = plugin.optionKeys ?? [];

    // Реестр меняется только после того, как install() отработал целиком: иначе упавший
    // на середине плагин оставит занятое имя и половину обёрток.
    const before = this.#transformers.length;
    try {
      plugin.install({
        ...context,
        use: (transformer) => {
          if (typeof transformer !== 'function') {
            throw new ItdConfigError(`Плагин «${name}» передал в use() не функцию`);
          }
          this.#transformers.push(transformer);
        },
      });
    } catch (error) {
      this.#transformers.length = before;
      throw error;
    }

    this.#names.add(name);
    for (const key of keys) this.#optionKeys.add(key);
  }

  /**
   * Прогоняет запрос через цепочку обёрток.
   *
   * Цепочка собирается на каждый запрос заново: плагин можно подключить в любой момент,
   * а обёрток единицы — экономить тут не на чем.
   *
   * @param execute настоящий запрос, вызывается самой внутренней обёрткой
   */
  run(
    request: RawRequestOptions,
    execute: (request: RawRequestOptions) => Promise<unknown>,
  ): Promise<unknown> {
    const chain = this.#transformers.reduceRight<(r: RawRequestOptions) => Promise<unknown>>(
      (next, transformer) => (current) => transformer(current, next),
      execute,
    );

    return chain(request);
  }
}
