import type { UserId } from '../models/common.js';
import type { ResolvedRuntimeConfig } from './config.js';
import type { CookieJar } from './cookies.js';
import type { RequestHandler } from './pipeline.js';
import { createDeviceId } from './runtime.js';

/** Области аккаунта и конкретной сессии для локального состояния плагинов. */
export interface AuthIdentity {
  /** Идентификатор пользователя; отсутствует у непрозрачного или повреждённого токена. */
  userId?: UserId | undefined;
  /** Идентификатор серверной сессии; отсутствует у непрозрачного или повреждённого токена. */
  sessionId?: string | undefined;
}

/**
 * Что конвейер запросов спрашивает у авторизации.
 *
 * Узкий контракт вместо полноценного менеджера сессии: pipeline не должен знать ни про
 * refresh-токены, ни про хранилище, ни про вход по паролю. Благодаря этому клиент с готовым
 * токеном не тянет за собой сессионную машинерию — она подставляется вызывающим кодом.
 *
 * Каждый метод соответствует ровно одной стадии конвейера. Готовые реализации —
 * {@link bearerToken}, {@link tokenProvider} и {@link anonymousAuth}.
 */
export interface AuthProvider {
  /**
   * Текущий токен доступа.
   *
   * Нужен там, где заголовок не поставить: SSE в браузере и WebSocket передают токен
   * параметром адреса. Конвейеру запросов достаточно {@link currentHeaders}.
   */
  token(): Promise<string | null>;
  /**
   * Готовит состояние авторизации до входа транспортной попытки в очередь.
   *
   * Чтение хранилища, обращение к внешнему источнику токена и отложенный вход асинхронны,
   * поэтому обязаны завершиться до захвата слота очереди.
   */
  prepare(): Promise<void>;
  /**
   * Заголовки уже подготовленной авторизации.
   *
   * Синхронность существенна: слой стоит внутри очереди, непосредственно перед транспортом,
   * и не должен запускать I/O. Зато запрос, отстоявший в очереди, получает самый свежий токен.
   */
  currentHeaders(): Record<string, string>;
  /**
   * Реакция на ответ `401`.
   *
   * @returns `true`, если токен обновлён и повторять попытку имеет смысл
   */
  recover(): Promise<boolean>;
  /** Значение заголовка `X-Device-Id`. Отправляется и с анонимными запросами. */
  deviceId(): Promise<string>;
  /** Снимает подписки при терминальном освобождении владельца. */
  dispose(): void;
}

/**
 * Что фабрика авторизации получает от собранного runtime.
 *
 * `handler` — тот же обработчик, которым пользуются ресурсы: вход и продление проходят
 * через общий конвейер с точечными skip-флагами, а не через второй, независимо
 * эволюционирующий путь.
 *
 * @internal
 */
export interface AuthProviderDeps {
  config: ResolvedRuntimeConfig;
  handler: RequestHandler;
  cookies: CookieJar;
  /** Вызывается синхронно перед сменой владельца авторизации. */
  onAccountChange?: (() => void) | undefined;
}

/**
 * Идентификатор устройства, общий для провайдеров без сессии.
 *
 * Значение своё у каждого провайдера: сервер различает по нему записи в списке сессий,
 * поэтому делить его между клиентами нельзя. Хранилища нет, так что перезапуск процесса
 * значение не переживает — в этом и разница с полноценной сессией.
 */
function localDeviceId(): () => Promise<string> {
  let deviceId: string | undefined;

  return () => {
    deviceId ??= createDeviceId();
    return Promise.resolve(deviceId);
  };
}

/**
 * Авторизации нет: заголовок не подставляется, ответ `401` не восстанавливается.
 *
 * @example
 * ```ts
 * const api = createRestClient(); // публичные эндпоинты доступны и без токена
 * ```
 */
export function anonymousAuth(): AuthProvider {
  return {
    token: () => Promise.resolve(null),
    prepare: () => Promise.resolve(),
    currentHeaders: () => ({}),
    recover: () => Promise.resolve(false),
    deviceId: localDeviceId(),
    dispose: () => {},
  };
}

/**
 * Готовый Bearer-токен: ни хранилища, ни продления.
 *
 * Ответ `401` уходит вызывающему коду как есть — обновить токен провайдеру нечем.
 * Для сессии, которая продлевает себя сама, нужен полный клиент.
 *
 * @example
 * ```ts
 * const api = createRestClient({ auth: bearerToken(process.env.ITD_TOKEN) });
 * ```
 */
export function bearerToken(accessToken: string): AuthProvider {
  const headers = { Authorization: `Bearer ${accessToken}` };

  return {
    token: () => Promise.resolve(accessToken),
    prepare: () => Promise.resolve(),
    currentHeaders: () => headers,
    recover: () => Promise.resolve(false),
    deviceId: localDeviceId(),
    dispose: () => {},
  };
}

/**
 * Токен из внешнего источника — хранилища секретов, кэша, соседнего сервиса.
 *
 * Источник спрашивается на стадии подготовки, до входа в очередь: там ожидание безопасно,
 * а слот транспорта ещё не занят. Значение держится до следующей подготовки, потому что
 * подстановка заголовков обязана быть синхронной.
 *
 * @example
 * ```ts
 * const api = createRestClient({ auth: tokenProvider(() => vault.read('itd')) });
 * ```
 */
export function tokenProvider(
  getToken: () => string | null | Promise<string | null>,
): AuthProvider {
  let cached: string | null = null;

  const read = async () => {
    cached = await getToken();
    return cached;
  };

  return {
    token: read,
    prepare: async () => {
      await read();
    },
    currentHeaders: () => (cached ? { Authorization: `Bearer ${cached}` } : {}),
    recover: () => Promise.resolve(false),
    deviceId: localDeviceId(),
    dispose: () => {
      cached = null;
    },
  };
}
