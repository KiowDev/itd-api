import type { OperationId } from '../../domain/operations.js';
import type { AuthIdentity } from '../auth-provider.js';
import type { Unsubscribe } from '../emitter.js';
import type { OperationMetadata } from '../operation.js';
import type { Logger, OperationRequestOptions } from '../options.js';

/**
 * Обёртка одной логической операции.
 *
 * Вызывается ровно один раз независимо от retry и auth recovery. Может изменить
 * параметры запроса, обработать публичный результат метода или завершить операцию локально.
 * `operationId`, HTTP-метод и retry safety задаются контрактом и не могут быть заменены.
 *
 * @param request описание логической операции; не изменяйте сам объект — передайте копию в `next`
 * @param next следующая обёртка либо выполнение операции
 * `next()` возвращает уже нормализованный результат: например `Page<Notification>`, а не
 * серверный объект с полем `notifications`. Если transformer не вызывает `next`, его
 * собственный результат считается готовым и повторно не нормализуется.
 *
 * @returns результат в том виде, в котором его получит вызывающий код
 *
 * @example Дописать заголовок ко всем операциям
 * ```ts
 * const transformer: OperationTransformer = (request, next) =>
 *   next({ ...request, headers: { ...request.headers, 'X-Trace': trace() } });
 * ```
 */
export type OperationTransformer = (
  request: OperationRequestOptions,
  next: (request: OperationRequestOptions) => Promise<unknown>,
) => Promise<unknown>;

/** Финальные данные одной транспортной попытки. */
export interface AttemptContext {
  /** Стабильная семантическая операция. */
  readonly operationId: OperationId;
  /** Нормализованный HTTP-метод. */
  readonly method: string;
  /** Исходный путь операции до разрешения service/base URL. */
  readonly path: string;
  /** Полностью разрешённый URL со строкой query. */
  readonly url: string;
  /** Итоговые заголовки. Сам объект mutable для подписи и diagnostic headers. */
  readonly headers: Headers;
  /** Номер transport attempt, начиная с 1. */
  readonly attempt: number;
  /** Тело после сериализации либо подготовки body factory. Поток нельзя читать заранее. */
  readonly body: BodyInit | undefined;
  /** Общий сигнал отмены и таймаута этой попытки. */
  readonly signal: AbortSignal;
}

/**
 * Продолжение attempt chain.
 *
 * В рамках одного interceptor его можно вызвать только один раз. Возвращает сырой ответ:
 * transport ещё не проверял status и не читал body.
 */
export type AttemptNext = () => Promise<Response>;

/**
 * Обёртка одной транспортной попытки.
 *
 * Получает уже разрешённый URL, итоговые заголовки, подготовленное тело и номер попытки.
 * Может дописать заголовки, измерить wire latency, обработать сырой `Response` или вернуть
 * синтетический `Response`. Семантический input здесь намеренно недоступен для изменения.
 *
 * Вызывается заново для каждого retry и auth recovery. `next()` разрешено вызвать один раз.
 * Если interceptor читает тело ответа, читать нужно `response.clone()`: исходный body после
 * цепочки разбирает transport. Исключение interceptor остаётся пользовательской ошибкой и не
 * классифицируется как сетевой сбой для автоматического retry.
 *
 * @param context окончательные данные текущей транспортной попытки
 * @param next следующий interceptor либо вызов `fetch`
 * @returns исходный или синтетический сырой `Response`
 */
export type AttemptInterceptor = (context: AttemptContext, next: AttemptNext) => Promise<Response>;

/** Регистрация расширений логической операции. */
export interface OperationExtensions {
  /** Возвращает неизменяемые метаданные зарегистрированной операции. */
  get(operationId: OperationId): OperationMetadata | undefined;
  /**
   * Подключает transformer.
   *
   * Зарегистрированные раньше оборачивают зарегистрированные позже. Возвращённая функция
   * идемпотентна и снимает только эту регистрацию.
   */
  use(transformer: OperationTransformer): Unsubscribe;
}

/** Регистрация расширений транспортной попытки. */
export interface AttemptExtensions {
  /**
   * Подключает interceptor.
   *
   * Зарегистрированные раньше оборачивают зарегистрированные позже. Возвращённая функция
   * идемпотентна и снимает только эту регистрацию.
   */
  use(interceptor: AttemptInterceptor): Unsubscribe;
}

/**
 * Освобождение ресурсов, заведённых плагином при установке.
 *
 * Вызывается после завершения логических операций, уже вошедших в расширения плагина,
 * поэтому может безопасно закрывать используемые ими соединения и хранилища.
 */
export type PluginTeardown = () => void | Promise<void>;

/** API, доступный плагину при подключении. */
export interface PluginApi {
  /** Базовый URL клиента — например чтобы разобрать абсолютные ссылки из ответа. */
  baseUrl: string;
  /** Отладочный вывод клиента, если он включён. */
  logger: Logger | undefined;
  /** Расширения логической операции: выполняются один раз и могут short-circuit сеть. */
  operations: OperationExtensions;
  /** Расширения wire attempt: выполняются заново после каждого retry/auth recovery. */
  attempts: AttemptExtensions;
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
}

/**
 * Плагин клиента.
 *
 * Подключается через `itd.use(plugin)` и регистрирует расширения одного или обоих уровней:
 * {@link OperationTransformer} для логической операции и {@link AttemptInterceptor} для
 * отдельной транспортной попытки. Core взаимодействует с плагином только через эти контракты
 * и его lifecycle, не зная деталей реализации.
 *
 * Настройки отдельного вызова плагин объявляет своим полем в `RequestExtensions` через
 * declaration merging. Пользователь передаёт их в `RequestOptions.extensions`, а operation
 * transformer читает только принадлежащий плагину namespace.
 *
 * @example Логирование логических операций
 * ```ts
 * const logging: ClientPlugin = {
 *   name: 'logging',
 *   install({ operations, logger }) {
 *     operations.use(async (request, next) => {
 *       logger?.info(`${request.method} ${request.path}`);
 *       return next(request);
 *     });
 *   },
 * };
 *
 * itd.use(logging);
 * ```
 */
export interface ClientPlugin {
  /** Имя плагина. Должно быть уникальным: повторное подключение — ошибка. */
  name: string;
  /** Плагины, которые обязаны быть подключены раньше этого. */
  requires?: readonly string[];
  /** Несовместимые плагины. Достаточно объявить конфликт с одной стороны. */
  conflicts?: readonly string[];
  /** Имена плагинов, снаружи которых должны стоять оба вида расширений этого плагина. */
  before?: readonly string[];
  /** Имена плагинов, внутри которых должны стоять оба вида расширений этого плагина. */
  after?: readonly string[];
  /**
   * Устанавливает плагин.
   *
   * Может вернуть функцию освобождения ресурсов. Она вызывается при `unuse()` или
   * окончательном `dispose()` клиента и может быть асинхронной. Сам `install()` синхронный:
   * регистрация расширений завершается до того, как `use()` вернёт управление.
   */
  // biome-ignore lint/suspicious/noConfusingVoidType: обычный sync install естественно возвращает void.
  install(api: PluginApi): void | PluginTeardown;
}
