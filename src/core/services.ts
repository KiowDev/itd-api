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
  /**
   * Слать ли заголовок авторизации.
   *
   * По умолчанию включено для основного хоста и его поддоменов. Для остальных хостов
   * авторизацию нужно разрешить явно: `auth: true`.
   */
  auth?: boolean | undefined;
}

/** Хост из URL. Пустая строка, если разобрать не удалось. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/** Тот же хост либо его поддомен. */
function isSameSite(primaryHost: string, host: string): boolean {
  if (!primaryHost || !host) return false;
  return host === primaryHost || host.endsWith(`.${primaryHost}`);
}

/** Именованные сервисы клиента. */
export class ServiceRegistry {
  readonly #services = new Map<string, ServiceDefinition>();
  /** Хост основного API. */
  readonly #primaryHost: string;

  /** @param primaryBaseUrl базовый URL клиента */
  constructor(primaryBaseUrl?: string) {
    this.#primaryHost = primaryBaseUrl ? hostOf(primaryBaseUrl) : '';
  }

  /**
   * Регистрирует сервис. Имя очищается от краевых пробелов, базовый URL приводится
   * к каноничному виду, а незаданный `auth` выводится из хоста.
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

    const baseUrl = normalizeBaseUrl(definition.baseUrl);
    if (definition.auth !== undefined && typeof definition.auth !== 'boolean') {
      throw new ItdConfigError(`services.${name}.auth должен быть boolean`);
    }

    let headers: Readonly<Record<string, string>> | undefined;
    if (definition.headers !== undefined) {
      if (
        typeof definition.headers !== 'object' ||
        definition.headers === null ||
        Array.isArray(definition.headers)
      ) {
        throw new ItdConfigError(`services.${name}.headers должен быть объектом строк`);
      }
      for (const [header, value] of Object.entries(definition.headers)) {
        if (typeof value !== 'string') {
          throw new ItdConfigError(`services.${name}.headers.${header} должен быть строкой`);
        }
      }
      headers = Object.freeze({ ...definition.headers });
    }

    const normalized = {
      ...definition,
      name,
      baseUrl,
      auth: definition.auth ?? isSameSite(this.#primaryHost, hostOf(baseUrl)),
      ...(headers ? { headers } : {}),
    } satisfies ServiceDefinition;

    this.#services.set(name, Object.freeze(normalized));
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

  /**
   * Принадлежит ли URL основному хосту клиента или его поддомену.
   *
   * Используется для безопасного значения по умолчанию у разового `baseUrl`: Bearer-токен
   * не должен уходить на посторонний хост без явного `skipAuth: false`.
   *
   * @internal
   */
  isPrimarySite(baseUrl: string): boolean {
    return isSameSite(this.#primaryHost, hostOf(baseUrl));
  }
}
