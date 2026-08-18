import { ItdConfigError } from '../core/errors.js';
import type { HttpClient } from '../core/execution/http.js';
import type { RequestOptions } from '../core/options.js';
import type { Session } from '../models/account.js';
import type { AuthState } from '../models/users.js';
import {
  AUTH_CHANGE_PASSWORD,
  AUTH_CHECK,
  AUTH_FORGOT_PASSWORD,
  AUTH_LOGOUT,
  AUTH_RESEND_OTP,
  AUTH_RESET_PASSWORD,
  AUTH_REVOKE_OTHER_SESSIONS,
  AUTH_REVOKE_SESSION,
  AUTH_SESSIONS,
  AUTH_SIGN_IN,
  AUTH_SIGN_UP,
  AUTH_VERIFY_OTP,
  type SignInResult,
  SignInStatus,
} from '../operations/auth.js';
import { AUTH_PATHS, type AuthManager, type TURNSTILE_SITE_KEY } from '../session/auth.js';
import { BaseResource } from './base.js';

/** Учётные данные для входа. */
export interface Credentials {
  email: string;
  password: string;
}

/**
 * Учётные данные вместе с токеном капчи.
 *
 * `turnstileToken` обязателен: без него сервер отвечает `VALIDATION_ERROR`, с недействительным —
 * `TURNSTILE_VERIFICATION_FAILED`. Токен даёт виджет Cloudflare Turnstile с ключом
 * {@link TURNSTILE_SITE_KEY}; он одноразовый и живёт несколько минут.
 */
export interface CaptchaCredentials extends Credentials {
  turnstileToken: string;
}

/** Запрос письма для сброса пароля. Капча обязательна, как и при входе. */
export interface ForgotPasswordInput {
  email: string;
  turnstileToken: string;
}

/**
 * Установка нового пароля.
 *
 * Сброс идёт тем же потоком с кодом, что и вход: {@link AuthResource.forgotPassword} выдаёт
 * `flowToken`, письмо приносит `otp`, и всё это вместе с новым паролем уходит сюда.
 */
export interface ResetPasswordInput {
  email: string;
  otp: string;
  flowToken: string;
  newPassword: string;
}

export type { SignInResult, SignInStatus as SignInStatusValue } from '../operations/auth.js';
/** Чем закончился вход: сразу токеном или запросом кода подтверждения. */
export { SignInStatus } from '../operations/auth.js';

/**
 * Результат входа.
 *
 * Сервер может как сразу выдать токен, так и потребовать код подтверждения — размеченное
 * объединение делает оба случая явными.
 */

/**
 * Авторизация, сессии и пароли.
 *
 * Доступна как `itd.auth`.
 */
export class AuthResource extends BaseResource {
  readonly #auth: AuthManager;

  constructor(http: HttpClient, deps: { auth: AuthManager }) {
    super(http);
    this.#auth = deps.auth;
  }

  /**
   * Проверяет состояние авторизации и возвращает текущего пользователя.
   *
   * Без авторизации возвращает `authenticated: false` и `user: null`.
   */
  check(options: RequestOptions = {}): Promise<AuthState> {
    return this.http.execute(AUTH_CHECK, {
      path: '/api/profile',
      ...options,
    });
  }

  /**
   * Регистрирует аккаунт и запускает подтверждение по коду.
   *
   * @returns `flowToken`, который нужно передать в {@link verifyOtp}
   */
  signUp(credentials: CaptchaCredentials, options: RequestOptions = {}): Promise<string> {
    return this.http.execute(AUTH_SIGN_UP, {
      path: AUTH_PATHS.signUp,
      body: credentials,
      skipAuth: true,
      skipAuthRefresh: true,
      ...options,
    });
  }

  /**
   * Выполняет вход.
   *
   * Если сервер потребовал код подтверждения, вернётся `status: 'otp_required'` —
   * тогда продолжайте через {@link verifyOtp} либо воспользуйтесь {@link signInWithOtp}.
   *
   * При успешном входе токен сохраняется в клиенте автоматически.
   *
   * @param credentials email, пароль и обязательный токен капчи — см. {@link CaptchaCredentials}
   */
  async signIn(
    credentials: CaptchaCredentials,
    options: RequestOptions = {},
  ): Promise<SignInResult> {
    const revision = this.#auth.revision();
    const cookies = this.#auth.createCookieFlow(false);
    const result = await this.http.execute(AUTH_SIGN_IN, {
      path: AUTH_PATHS.signIn,
      body: credentials,
      skipAuth: true,
      skipAuthRefresh: true,
      cookieJar: cookies,
      ...options,
    });

    if (result.status === SignInStatus.Authenticated) {
      await this.#auth.setAccessToken(result.accessToken, revision, cookies);
    } else {
      this.#auth.commitCookieFlow(cookies, revision);
    }
    return result;
  }

  /**
   * Подтверждает вход кодом из письма.
   *
   * Полученный токен сохраняется в клиенте автоматически.
   */
  async verifyOtp(
    input: Credentials & { otp: string; flowToken: string },
    options: RequestOptions = {},
  ): Promise<string> {
    const revision = this.#auth.revision();
    const cookies = this.#auth.createCookieFlow();
    const accessToken = await this.http.execute(AUTH_VERIFY_OTP, {
      path: AUTH_PATHS.verifyOtp,
      body: input,
      skipAuth: true,
      skipAuthRefresh: true,
      cookieJar: cookies,
      ...options,
    });

    await this.#auth.setAccessToken(accessToken, revision, cookies);
    return accessToken;
  }

  /** Отправляет код подтверждения повторно. */
  resendOtp(
    input: { email: string; flowToken: string },
    options: RequestOptions = {},
  ): Promise<void> {
    return this.voidOperation(AUTH_RESEND_OTP, {
      path: AUTH_PATHS.resendOtp,
      body: input,
      skipAuth: true,
      skipAuthRefresh: true,
      ...options,
    });
  }

  /**
   * Полный вход с подтверждением по коду.
   *
   * Удобно для скриптов и ботов: код запрашивается функцией `getOtp`, а всё остальное
   * библиотека делает сама.
   *
   * @example
   * ```ts
   * import { createInterface } from 'node:readline/promises';
   *
   * const rl = createInterface({ input: process.stdin, output: process.stdout });
   *
   * const token = await itd.auth.signInWithOtp({
   *   email, password,
   *   getOtp: () => rl.question('Код из письма: '),
   * });
   * ```
   */
  async signInWithOtp(
    input: CaptchaCredentials & { getOtp: () => string | Promise<string> },
    options: RequestOptions = {},
  ): Promise<string> {
    const { getOtp, ...credentials } = input;
    const result = await this.signIn(credentials, options);

    if (result.status === SignInStatus.Authenticated) return result.accessToken;

    if (!result.flowToken) {
      throw new ItdConfigError(
        'Сервер запросил код подтверждения, но не вернул flowToken — продолжить вход невозможно',
      );
    }

    const otp = await getOtp();

    // Токен капчи сюда не передаётся: он одноразовый и уже потрачен на sign-in,
    // а verify-otp капчу не требует.
    return this.verifyOtp(
      {
        email: credentials.email,
        password: credentials.password,
        otp,
        flowToken: result.flowToken,
      },
      options,
    );
  }

  /**
   * Обновляет токен доступа.
   *
   * Параллельные вызовы объединяются в один сетевой запрос. При включённом `autoRefresh`
   * вызывать вручную обычно не нужно.
   */
  refresh(): Promise<string> {
    return this.#auth.refresh();
  }

  /**
   * Есть ли признак живой сессии обновления.
   *
   * Проверяет cookie `is_auth`, которую сервер ставит рядом с refresh-токеном, а также
   * refresh-токен, переданный строкой. Позволяет не дёргать API у неавторизованного
   * пользователя. В браузере всегда `true`: cookie ведёт сама среда, и прочитать её
   * из JS нельзя.
   *
   * Читает {@link TokenStorage}, поэтому результат верен и до первого запроса.
   *
   * @example
   * ```ts
   * if (await itd.auth.hasRefreshSession()) await itd.auth.refresh();
   * else redirectToLogin();
   * ```
   */
  hasRefreshSession(): Promise<boolean> {
    return this.#auth.hasRefreshSession();
  }

  /** Завершает текущую сессию на сервере и очищает локальную. */
  async logout(options: RequestOptions = {}): Promise<void> {
    await this.voidOperation(AUTH_LOGOUT, {
      path: AUTH_PATHS.logout,
      skipAuthRefresh: true,
      ...options,
    });

    await this.#auth.clear();
  }

  /**
   * Завершает все сессии пользователя и очищает локальную.
   *
   * Собран из двух запросов, потому что единого эндпоинта на сервере нет:
   * `POST /api/v1/auth/logout-all` отвечает `404`. Сначала отзываются все прочие сессии
   * (`DELETE /api/v1/auth/sessions`), затем завершается текущая — в обратном порядке
   * отзывать было бы уже нечем.
   */
  async logoutAll(options: RequestOptions = {}): Promise<void> {
    await this.revokeOtherSessions(options);
    await this.logout(options);
  }

  /** Забывает сессию локально, не обращаясь к серверу. */
  signOut(): Promise<void> {
    return this.#auth.clear();
  }

  /**
   * Запрашивает письмо с кодом для сброса пароля.
   *
   * @returns `flowToken`, который нужно передать в {@link resetPassword}
   */
  forgotPassword(input: ForgotPasswordInput, options: RequestOptions = {}): Promise<string> {
    return this.http.execute(AUTH_FORGOT_PASSWORD, {
      path: AUTH_PATHS.forgotPassword,
      body: input,
      skipAuth: true,
      skipAuthRefresh: true,
      ...options,
    });
  }

  /**
   * Устанавливает новый пароль по коду из письма.
   *
   * Сервер ждёт все четыре поля сразу — `email`, `otp`, `flowToken` и `newPassword`;
   * при нехватке любого отвечает `422`.
   */
  resetPassword(input: ResetPasswordInput, options: RequestOptions = {}): Promise<void> {
    return this.voidOperation(AUTH_RESET_PASSWORD, {
      path: AUTH_PATHS.resetPassword,
      body: input,
      skipAuth: true,
      skipAuthRefresh: true,
      ...options,
    });
  }

  /**
   * Полный сброс пароля с кодом из письма.
   *
   * Тот же приём, что и {@link signInWithOtp}: код запрашивается функцией `getOtp`,
   * остальное библиотека делает сама.
   *
   * @example
   * ```ts
   * await itd.auth.resetPasswordWithOtp({
   *   email,
   *   turnstileToken,
   *   newPassword,
   *   getOtp: () => rl.question('Код из письма: '),
   * });
   * ```
   */
  async resetPasswordWithOtp(
    input: ForgotPasswordInput & {
      newPassword: string;
      getOtp: () => string | Promise<string>;
    },
    options: RequestOptions = {},
  ): Promise<void> {
    const flowToken = await this.forgotPassword(
      { email: input.email, turnstileToken: input.turnstileToken },
      options,
    );

    const otp = await input.getOtp();

    await this.resetPassword(
      { email: input.email, otp, flowToken, newPassword: input.newPassword },
      options,
    );
  }

  /**
   * Меняет пароль. Требует действующей сессии.
   *
   * При неверном текущем пароле сервер отвечает `ACCOUNT_CURRENT_PASSWORD_INCORRECT`.
   *
   * @example
   * ```ts
   * await itd.auth.changePassword({ currentPassword, newPassword });
   * ```
   */
  changePassword(
    input: { currentPassword: string; newPassword: string },
    options: RequestOptions = {},
  ): Promise<void> {
    return this.voidOperation(AUTH_CHANGE_PASSWORD, {
      path: AUTH_PATHS.changePassword,
      body: { currentPassword: input.currentPassword, newPassword: input.newPassword },
      ...options,
    });
  }

  /** Загружает список активных сессий. У текущей поле `isCurrent` равно `true`. */
  sessions(options: RequestOptions = {}): Promise<Session[]> {
    return this.http.execute(AUTH_SESSIONS, {
      path: AUTH_PATHS.sessions,
      ...options,
    });
  }

  /** Завершает указанную сессию. */
  revokeSession(sessionId: string, options: RequestOptions = {}): Promise<void> {
    return this.voidOperation(AUTH_REVOKE_SESSION, {
      path: `${AUTH_PATHS.sessions}/${encodeURIComponent(sessionId)}`,
      ...options,
    });
  }

  /** Завершает все сессии, кроме текущей. */
  revokeOtherSessions(options: RequestOptions = {}): Promise<void> {
    return this.voidOperation(AUTH_REVOKE_OTHER_SESSIONS, {
      path: AUTH_PATHS.sessions,
      ...options,
    });
  }
}
