import type { OperationId } from '../../domain/operations.js';
import type { AuthIdentity } from '../auth-provider.js';
import type { Unsubscribe } from '../emitter.js';
import type { OperationMetadata } from '../operation.js';
import type { Logger, OperationRequestOptions } from '../options.js';

/**
 * Обёртка одной логической операции.
 *
 * Вызывается один раз независимо от повторов и обновления авторизации. Может изменить
 * параметры запроса, обработать публичный результат метода или завершить операцию локально.
 * `operationId`, HTTP-метод и безопасность повтора задаются операцией.
 *
 * @param request описание логической операции; не изменяйте сам объект — передайте копию в `next`
 * @param next следующая обёртка либо выполнение операции
 * `next()` возвращает результат публичного метода. Если обёртка не вызывает `next`, её
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
  /** Постоянный идентификатор операции. */
  readonly operationId: OperationId;
  /** Нормализованный HTTP-метод. */
  readonly method: string;
  /** Исходный путь операции до выбора сервиса или `baseUrl`. */
  readonly path: string;
  /** Полный URL со строкой запроса. */
  readonly url: string;
  /** Итоговые изменяемые заголовки. */
  readonly headers: Headers;
  /** Номер сетевой попытки, начиная с 1. */
  readonly attempt: number;
  /** Подготовленное тело запроса. Поток нельзя читать заранее. */
  readonly body: BodyInit | undefined;
  /** Общий сигнал отмены и таймаута этой попытки. */
  readonly signal: AbortSignal;
}

/**
 * Продолжение цепочки перехватчиков. Можно вызвать только один раз.
 */
export type AttemptNext = () => Promise<Response>;

/**
 * Обёртка одной транспортной попытки.
 *
 * Получает уже разрешённый URL, итоговые заголовки, подготовленное тело и номер попытки.
 * Может изменить заголовки, измерить задержку, обработать сырой `Response` или вернуть
 * созданный вручную `Response`.
 *
 * Вызывается для каждой сетевой попытки. Если перехватчик читает тело ответа, используйте
 * `response.clone()`: исходный ответ дальше обрабатывает транспорт.
 *
 * @param context окончательные данные текущей транспортной попытки
 * @param next следующий перехватчик либо вызов `fetch`
 * @returns исходный или синтетический сырой `Response`
 */
export type AttemptInterceptor = (context: AttemptContext, next: AttemptNext) => Promise<Response>;

/** Регистрация расширений логической операции. */
export interface OperationExtensions {
  /** Возвращает неизменяемые метаданные зарегистрированной операции. */
  get(operationId: OperationId): OperationMetadata | undefined;
  /**
   * Подключает обёртку операции.
   *
   * Зарегистрированные раньше оборачивают зарегистрированные позже. Возвращённая функция
   * идемпотентна и снимает только эту регистрацию.
   */
  use(transformer: OperationTransformer): Unsubscribe;
}

/** Регистрация расширений транспортной попытки. */
export interface AttemptExtensions {
  /**
   * Подключает перехватчик попытки.
   *
   * Зарегистрированные раньше оборачивают зарегистрированные позже. Возвращённая функция
   * идемпотентна и снимает только эту регистрацию.
   */
  use(interceptor: AttemptInterceptor): Unsubscribe;
}

/**
 * Функция освобождения ресурсов плагина.
 */
export type PluginTeardown = () => void | Promise<void>;

/** API, доступный плагину при подключении. */
export interface PluginApi {
  /** Базовый URL клиента — например чтобы разобрать абсолютные ссылки из ответа. */
  baseUrl: string;
  /** Логгер клиента, если он включён. */
  logger: Logger | undefined;
  /** Обёртки логической операции. */
  operations: OperationExtensions;
  /** Перехватчики сетевой попытки. */
  attempts: AttemptExtensions;
  /**
   * Внутренний идентификатор текущей авторизации.
   */
  getAuthScope?: (() => string) | undefined;
  /**
   * Загружает сессию и возвращает идентификаторы аккаунта и конкретной сессии из JWT.
   *
   * Используйте для общего состояния нескольких клиентов одного аккаунта.
   */
  getAuthIdentity?: (() => Promise<AuthIdentity>) | undefined;
}

/**
 * Плагин клиента.
 *
 * Подключается через `itd.use(plugin)` и регистрирует расширения одного или обоих уровней:
 * {@link OperationTransformer} для логической операции и {@link AttemptInterceptor} для
 * отдельной транспортной попытки.
 *
 * Настройки отдельного вызова плагин объявляет своим полем в `RequestExtensions` через
 * дополнение интерфейса. Пользователь передаёт их в `RequestOptions.extensions`, а обёртка
 * операции читает поле своего плагина.
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
