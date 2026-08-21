import type { TokenStorage } from './storage.js';

/**
 * Вход по логину и паролю.
 *
 * Вход требует токен капчи Cloudflare Turnstile, поэтому полностью автоматическим он быть
 * не может: капчу должен решить кто-то снаружи. Токен одноразовый и живёт несколько минут,
 * так что долгоживущему клиенту нужен `getTurnstileToken` — он спрашивается заново перед
 * каждой попыткой входа. Одиночный `turnstileToken` годится для разового скрипта.
 */
export interface CredentialsAuth {
  email: string;
  password: string;
  /** Разовый токен капчи. Для повторного входа после истечения сессии не подойдёт. */
  turnstileToken?: string | undefined;
  /** Источник свежего токена капчи. Спрашивается перед каждым входом. */
  getTurnstileToken?: (() => string | Promise<string>) | undefined;
}

/**
 * Как клиент получает доступ к API.
 *
 * Четыре формы — от разового вызова с готовым токеном до полноценной сессии, которую
 * библиотека заводит и продлевает сама.
 *
 * Опция необязательна: если {@link SessionOptions.storage} уже содержит сессию, доступ
 * берётся оттуда. Когда заданы обе, хранилище главнее — оно отражает текущее состояние
 * сессии, — а недостающие поля берутся отсюда.
 *
 * @example
 * ```ts
 * new ItdClient({ auth: '<accessToken>' });                    // разовый вызов
 * new ItdClient({ auth: { accessToken, refreshToken } });      // восстановить сессию
 * new ItdClient({ auth: { email, password, getTurnstileToken } });  // залогиниться самому
 * new ItdClient({ auth: { getToken: () => vault.read() } });   // токен из внешнего источника
 * ```
 */
export type AuthInput =
  | string
  | { accessToken: string; refreshToken?: string | undefined }
  | CredentialsAuth
  | { getToken: () => string | null | Promise<string | null> };

/**
 * Настройки сессии: чем представляться и как её продлевать.
 *
 * Отделены от {@link RuntimeOptions} намеренно: минимальному клиенту с готовым токеном
 * ничего из этого не нужно, и он не должен тянуть за собой ни хранилище, ни разбор JWT,
 * ни вход по паролю.
 */
export interface SessionOptions {
  /** Авторизация. Без неё доступны только публичные эндпоинты. */
  auth?: AuthInput | undefined;
  /** Где хранить сессию. По умолчанию {@link MemoryTokenStorage}. */
  storage?: TokenStorage | undefined;
  /**
   * Обновлять токен перед истечением и восстанавливать сессию при ответе `401`.
   * По умолчанию `true`.
   *
   * При `false` библиотека просто пробросит {@link ItdAuthError}, а обновлением
   * вы управляете сами через `itd.auth.refresh()`.
   */
  autoRefresh?: boolean | undefined;
  /**
   * Пытаться ли войти заново, если обновление токена не удалось.
   *
   * Работает, только когда в `auth` переданы email и пароль. По умолчанию `true`.
   */
  reloginOnRefreshFailure?: boolean | undefined;
  /**
   * Значение заголовка `X-Device-Id`, который уходит с каждым запросом.
   *
   * Сервер различает по нему записи в списке сессий, поэтому значение должно быть стабильным.
   * Если не задать, библиотека заведёт идентификатор сама и сохранит его в {@link ItdSession},
   * так что при постоянном хранилище он переживёт перезапуск процесса.
   */
  deviceId?: string | undefined;
}
