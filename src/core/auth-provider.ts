import type { ResolvedRuntimeConfig } from './config.js';
import type { CookieJar } from './cookies.js';
import type { RequestHandler } from './pipeline.js';
import { createDeviceId } from './runtime.js';

/**
 * Что конвейер запросов спрашивает у авторизации.
 *
 * Узкий контракт вместо полноценного менеджера сессии: pipeline не должен знать ни про
 * refresh-токены, ни про хранилище, ни про вход по паролю. Благодаря этому клиент с готовым
 * токеном не тянет за собой сессионную машинерию — она подставляется вызывающим кодом.
 *
 * Каждый метод соответствует ровно одной стадии конвейера, см. `ClientRuntimeStage`.
 *
 * @internal
 */
export interface AuthProvider {
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
 * Авторизации нет: заголовок не подставляется, ответ `401` не восстанавливается.
 *
 * Фабрика, а не константа: идентификатор устройства должен быть свой у каждого клиента —
 * сервер различает по нему записи в списке сессий.
 *
 * @internal
 */
export function anonymousAuth(): AuthProvider {
  let deviceId: string | undefined;

  return {
    prepare: () => Promise.resolve(),
    currentHeaders: () => ({}),
    recover: () => Promise.resolve(false),
    deviceId: () => {
      deviceId ??= createDeviceId();
      return Promise.resolve(deviceId);
    },
    dispose: () => {},
  };
}
