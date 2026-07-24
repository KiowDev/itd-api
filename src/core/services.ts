import { ItdConfigError } from './errors.js';
import { normalizeBaseUrl } from './url.js';

/** Сервис платформы на отдельном домене. */
export interface ServiceDefinition {
  /** Имя, по которому запрос выбирает сервис: `{ service: 'status' }`. */
  name: string;
  /** Базовый URL сервиса. */
  baseUrl: string;
  /** Заголовки, добавляемые к каждому запросу сервиса. Заголовки вызова важнее. */
  headers?: Record<string, string> | undefined;
  /** Слать ли заголовок авторизации. По умолчанию `true`. */
  auth?: boolean | undefined;
}

/** Именованные сервисы клиента. */
export class ServiceRegistry {
  readonly #services = new Map<string, ServiceDefinition>();

  /**
   * Регистрирует сервис. Имя очищается от краевых пробелов, базовый URL приводится
   * к каноничному виду.
   *
   * @throws {ItdConfigError} если имя пустое, имя занято или `baseUrl` не абсолютный URL
   */
  define(definition: ServiceDefinition): void {
    const raw = definition?.name;
    if (typeof raw !== 'string' || raw.trim() === '') {
      throw new ItdConfigError('У сервиса должно быть непустое имя');
    }

    const name = raw.trim();
    if (this.#services.has(name)) {
      throw new ItdConfigError(`Сервис «${name}» уже зарегистрирован и не может быть заменён`);
    }

    this.#services.set(name, {
      ...definition,
      name,
      baseUrl: normalizeBaseUrl(definition.baseUrl),
    });
  }

  /** Определение сервиса либо `undefined`, если такого нет. */
  get(name: string): ServiceDefinition | undefined {
    return this.#services.get(name);
  }

  /** Зарегистрирован ли сервис с таким именем. */
  has(name: string): boolean {
    return this.#services.has(name);
  }

  /**
   * Определение сервиса.
   *
   * @throws {ItdConfigError} если сервис не зарегистрирован
   */
  require(name: string): ServiceDefinition {
    const service = this.#services.get(name);
    if (!service) {
      const known = [...this.#services.keys()];
      throw new ItdConfigError(
        `Сервис «${name}» не зарегистрирован. ` +
          (known.length > 0
            ? `Известны: ${known.join(', ')}`
            : 'Зарегистрируйте его через itd.defineService() или опцию services'),
      );
    }
    return service;
  }

  /**
   * Базовый URL сервиса.
   *
   * @throws {ItdConfigError} если сервис не зарегистрирован
   */
  resolveBaseUrl(name: string): string {
    return this.require(name).baseUrl;
  }
}
