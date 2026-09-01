import type { CaptchaChoice, CaptchaField, CaptchaType } from '../types/enums.js';
import type { TokenStorage } from './storage.js';

/**
 * Как проходить капчу при входе по логину и паролю.
 *
 * Токен одноразовый и живёт несколько минут, поэтому долгоживущему клиенту нужен не готовый
 * токен, а его источник: {@link CaptchaOptions.getToken} спрашивается перед каждым входом.
 * В Node источником служит `@itd-api/captcha` — `captcha: createCaptchaSolver()`.
 */
export interface CaptchaOptions {
  /**
   * Какую капчу решать. По умолчанию `CaptchaChoice.Auto` — провайдера называет сервер.
   *
   * Явно названный провайдер экономит запрос `captcha/provider` перед каждым входом, но
   * перестаёт работать, если сервер переключится на другой виджет.
   */
  type?: CaptchaChoice | undefined;
  /** Разовый токен. Для повторного входа после истечения сессии не подойдёт. */
  token?: string | undefined;
  /**
   * Источник свежего токена. Спрашивается перед каждым входом.
   *
   * Получает имя провайдера, чью капчу нужно решить, и возвращает токен.
   */
  getToken?: ((type: CaptchaType) => string | Promise<string>) | undefined;
  /**
   * Поле тела запроса, в котором сервер ждёт токен.
   *
   * Учитывается только при явно названном {@link CaptchaOptions.type}: при
   * `CaptchaChoice.Auto` поле называет сам сервер, и его слово точнее. Пригодится,
   * если сервер переименовал поле, а версия SDK об этом ещё не знает.
   */
  field?: CaptchaField | undefined;
}

/**
 * Вход по логину и паролю.
 *
 * Вход требует токен капчи — см. {@link CaptchaOptions}.
 */
export interface CredentialsAuth {
  email: string;
  password: string;
  /** Как проходить капчу. Без неё вход по паролю не начнётся. */
  captcha?: CaptchaOptions | undefined;
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
 * new ItdClient({ auth: { email, password, captcha: createCaptchaSolver() } });  // вход по паролю
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
