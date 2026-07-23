import type { RawRequestOptions } from '../types/options.js';
import type { RequestHandler } from './pipeline.js';
import type { PluginRegistry } from './plugins.js';

/** Что нужно фасаду для работы. */
export interface HttpClientDeps {
  /** Готовый обработчик — вся цепочка слоёв поверх транспорта. */
  handler: RequestHandler;
  /** Реестр плагинов: у него ресурсы спрашивают имена заявленных опций. */
  plugins: PluginRegistry;
  baseUrl: string;
}

/**
 * Точка входа ресурсов в конвейер запросов.
 *
 * Принимает готовый обработчик — цепочку слоёв поверх транспорта, собранную
 * в {@link ItdClient}, — и отдаёт ресурсам метод `request` и имена опций плагинов.
 * О слоях и их порядке ресурсы не знают.
 */
export class HttpClient {
  readonly #handler: RequestHandler;
  readonly #plugins: PluginRegistry;
  readonly #baseUrl: string;

  constructor(deps: HttpClientDeps) {
    this.#handler = deps.handler;
    this.#plugins = deps.plugins;
    this.#baseUrl = deps.baseUrl;
  }

  /** Базовый URL, к которому обращается клиент. */
  get baseUrl(): string {
    return this.#baseUrl;
  }

  /**
   * Имена опций запроса, заявленные плагинами.
   *
   * Читается ресурсами: они переносят в транспорт только известные поля, а чужие,
   * если их никто не заявил, отсеивают.
   */
  get pluginOptionKeys(): ReadonlySet<string> {
    return this.#plugins.optionKeys;
  }

  /**
   * Выполняет запрос к API через собранный конвейер.
   *
   * @typeParam T ожидаемая форма ответа после снятия обёртки `{ data: … }`
   * @throws {ItdApiError} если сервер ответил статусом ≥ 400
   * @throws {ItdTimeoutError} если истёк таймаут
   * @throws {ItdAbortError} если запрос отменён через `signal`
   * @throws {ItdNetworkError} если запрос не дошёл до сервера
   */
  request<T = unknown>(options: RawRequestOptions): Promise<T> {
    return this.#handler(options) as Promise<T>;
  }
}
