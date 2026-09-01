import type { CaptchaToken } from '../operations/auth.js';
import type { CaptchaChoice, CaptchaField, CaptchaType } from '../types/enums.js';
import type { TokenStorage } from './storage.js';

/**
 * Источник токенов капчи.
 *
 * Токен одноразовый и живёт несколько минут, поэтому долгоживущему клиенту нужен не готовый
 * токен, а источник: он спрашивается перед каждым запросом, которому нужна капча.
 * В Node источником служит `@itd-api/captcha` — `captcha: createCaptchaSolver()`.
 */
export interface CaptchaSolver {
  /** Получает имя провайдера, чью капчу нужно пройти, и возвращает токен. */
  getToken(type: CaptchaType): string | Promise<string>;
  /**
   * Какую капчу проходить. По умолчанию `CaptchaChoice.Auto` — провайдера называет сервер.
   *
   * Явно названный провайдер экономит запрос `captcha/provider`, но перестаёт работать,
   * если сервер откажется от этого виджета.
   */
  type?: CaptchaChoice | undefined;
  /**
   * Поле тела запроса, в котором сервер ждёт токен.
   *
   * Учитывается только при явно названном {@link CaptchaSolver.type}: при
   * `CaptchaChoice.Auto` поле называет сам сервер, и его слово точнее. Пригодится,
   * если сервер переименовал поле, а версия SDK об этом ещё не знает.
   */
  field?: CaptchaField | undefined;
}

/** Источник токенов капчи: объект с `getToken` либо сама функция. */
export type CaptchaSolverInput = CaptchaSolver | ((type: CaptchaType) => string | Promise<string>);

/**
 * Вход по логину и паролю.
 *
 * Капчу, если сервер её потребует, пройдёт {@link SessionOptions.captcha}.
 */
export interface CredentialsAuth {
  email: string;
  password: string;
  /**
   * Готовый токен капчи на первый вход.
   *
   * Расходуется ровно однажды: повторный вход и восстановление сессии пойдут уже
   * к {@link SessionOptions.captcha}.
   */
  captcha?: CaptchaToken | undefined;
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
 * new ItdClient({ auth: { email, password }, captcha: createCaptchaSolver() });  // вход по паролю
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
  /**
   * Откуда брать токен капчи, когда сервер её потребует: при входе по паролю, регистрации,
   * запросе письма для сброса пароля и подтверждении QR-входа.
   *
   * С этой опцией токен можно не передавать в сами методы — клиент получит его сам.
   */
  captcha?: CaptchaSolverInput | undefined;
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
