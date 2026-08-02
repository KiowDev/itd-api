import type { ClientHooks, Logger, RawRequestOptions } from '../../types/options.js';
import type { AuthIdentity } from '../auth.js';

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

/** Освобождение ресурсов, заведённых плагином при установке. */
export type PluginTeardown = () => void | Promise<void>;

/** Что плагин получает при подключении. */
export interface PluginContext {
  /** Базовый URL клиента — например чтобы разобрать абсолютные ссылки из ответа. */
  baseUrl: string;
  /** Отладочный вывод клиента, если он включён. */
  logger: Logger | undefined;
  /**
   * Непрозрачная fallback-область текущей авторизации.
   *
   * Нужна плагинам, которые обязаны безопасно изолировать непрозрачный токен. Для объединения
   * состояния копий одного аккаунта используйте {@link getAuthIdentity}.
   */
  getAuthScope?: (() => string) | undefined;
  /**
   * Загружает сессию и возвращает идентификаторы аккаунта и конкретной сессии из JWT.
   *
   * Предпочтительнее {@link getAuthScope} для состояния, которое должно объединяться между
   * несколькими экземплярами клиента одного аккаунта.
   */
  getAuthIdentity?: (() => Promise<AuthIdentity>) | undefined;
  /** Добавляет обёртку запроса. Подключённые раньше оказываются снаружи. */
  use(transformer: Transformer): void;
  /**
   * Добавляет перехватчики отдельных сетевых попыток.
   *
   * В отличие от {@link use}, они видят каждый retry и сырой `Response` до чтения тела.
   * Несколько наборов хуков одного плагина вызываются в порядке регистрации.
   */
  useHooks(hooks: ClientHooks): void;
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
  /** Плагины, которые обязаны быть подключены раньше этого. */
  requires?: readonly string[];
  /** Несовместимые плагины. Достаточно объявить конфликт с одной стороны. */
  conflicts?: readonly string[];
  /** Имена плагинов, снаружи которых должна стоять эта обёртка. */
  before?: readonly string[];
  /** Имена плагинов, внутри которых должна стоять эта обёртка. */
  after?: readonly string[];
  /**
   * Устанавливает плагин.
   *
   * Может вернуть функцию освобождения ресурсов. Она вызывается при `unuse()` или
   * окончательном `dispose()` клиента и может быть асинхронной.
   */
  install(context: PluginContext): unknown;
}
