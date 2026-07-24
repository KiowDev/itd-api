import { AUTH_PATHS, type AuthManager, type TURNSTILE_SITE_KEY } from '../core/auth.js';
import { ItdConfigError } from '../core/errors.js';
import type { HttpClient } from '../core/http.js';
import { pickArray, pickString } from '../core/unwrap.js';
import { joinUrl } from '../core/url.js';
import type { Session } from '../types/models.js';
import type { RequestOptions } from '../types/options.js';
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

/** Провайдер внешнего входа. */
export const OAuthProvider = Object.freeze({
  Yandex: 'yandex',
  Google: 'google',
} as const);
export type OAuthProvider = (typeof OAuthProvider)[keyof typeof OAuthProvider];

/** Чем закончился вход: сразу токеном или запросом кода подтверждения. */
export const SignInStatus = Object.freeze({
  Authenticated: 'authenticated',
  OtpRequired: 'otp_required',
} as const);
export type SignInStatus = (typeof SignInStatus)[keyof typeof SignInStatus];

/**
 * Результат входа.
 *
 * Сервер может как сразу выдать токен, так и потребовать код подтверждения — размеченное
 * объединение делает оба случая явными.
 */
export type SignInResult =
  | { status: 'authenticated'; accessToken: string }
  | { status: 'otp_required'; flowToken: string | undefined };

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
   * Регистрирует аккаунт и запускает подтверждение по коду.
   *
   * @returns `flowToken`, который нужно передать в {@link verifyOtp}
   */
  async signUp(credentials: CaptchaCredentials, options: RequestOptions = {}): Promise<string> {
    const body = await this.http.request({
      method: 'POST',
      path: AUTH_PATHS.signUp,
      body: credentials,
      skipAuth: true,
      skipAuthRefresh: true,
      ...this.requestOptions(options),
    });

    const flowToken = pickString(body, 'flowToken');
    if (!flowToken) {
      throw new ItdConfigError('Сервер не вернул flowToken при регистрации');
    }

    return flowToken;
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
    const body = await this.http.request({
      method: 'POST',
      path: AUTH_PATHS.signIn,
      body: credentials,
      skipAuth: true,
      skipAuthRefresh: true,
      ...this.requestOptions(options),
    });

    const accessToken = pickString(body, 'accessToken');

    if (accessToken) {
      await this.#auth.setAccessToken(accessToken);
      return { status: SignInStatus.Authenticated, accessToken };
    }

    return { status: SignInStatus.OtpRequired, flowToken: pickString(body, 'flowToken') };
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
    const body = await this.http.request({
      method: 'POST',
      path: AUTH_PATHS.verifyOtp,
      body: input,
      skipAuth: true,
      skipAuthRefresh: true,
      ...this.requestOptions(options),
    });

    const accessToken = pickString(body, 'accessToken');
    if (!accessToken) {
      throw new ItdConfigError('Сервер не вернул accessToken после подтверждения кода');
    }

    await this.#auth.setAccessToken(accessToken);
    return accessToken;
  }

  /** Отправляет код подтверждения повторно. */
  resendOtp(
    input: { email: string; flowToken: string },
    options: RequestOptions = {},
  ): Promise<void> {
    return this.http.request<void>({
      method: 'POST',
      path: AUTH_PATHS.resendOtp,
      body: input,
      skipAuth: true,
      skipAuthRefresh: true,
      ...this.requestOptions(options),
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
    await this.http.request<void>({
      method: 'POST',
      path: AUTH_PATHS.logout,
      skipAuthRefresh: true,
      ...this.requestOptions(options),
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
  async forgotPassword(input: ForgotPasswordInput, options: RequestOptions = {}): Promise<string> {
    const body = await this.http.request({
      method: 'POST',
      path: AUTH_PATHS.forgotPassword,
      body: input,
      skipAuth: true,
      skipAuthRefresh: true,
      ...this.requestOptions(options),
    });

    const flowToken = pickString(body, 'flowToken');
    if (!flowToken) {
      throw new ItdConfigError('Сервер не вернул flowToken при запросе сброса пароля');
    }

    return flowToken;
  }

  /**
   * Устанавливает новый пароль по коду из письма.
   *
   * Сервер ждёт все четыре поля сразу — `email`, `otp`, `flowToken` и `newPassword`;
   * при нехватке любого отвечает `422`.
   */
  resetPassword(input: ResetPasswordInput, options: RequestOptions = {}): Promise<void> {
    return this.http.request<void>({
      method: 'POST',
      path: AUTH_PATHS.resetPassword,
      body: input,
      skipAuth: true,
      skipAuthRefresh: true,
      ...this.requestOptions(options),
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
    return this.http.request<void>({
      method: 'POST',
      path: AUTH_PATHS.changePassword,
      body: { currentPassword: input.currentPassword, newPassword: input.newPassword },
      ...this.requestOptions(options),
    });
  }

  /**
   * Возвращает адрес для входа через внешнего провайдера.
   *
   * Сам переход выполняет приложение: в браузере — редиректом, в приложении — открытием
   * системного браузера.
   *
   * @example
   * ```ts
   * window.location.href = itd.auth.oauthUrl('yandex');
   * ```
   */
  oauthUrl(provider: OAuthProvider): string {
    return joinUrl(this.http.baseUrl, `${AUTH_PATHS.oauthLogin}/${provider}`);
  }

  /** Загружает список активных сессий. У текущей поле `isCurrent` равно `true`. */
  async sessions(options: RequestOptions = {}): Promise<Session[]> {
    const body = await this.http.request({
      method: 'GET',
      path: AUTH_PATHS.sessions,
      ...this.requestOptions(options),
    });

    return pickArray<Session>(body, 'sessions');
  }

  /** Завершает указанную сессию. */
  revokeSession(sessionId: string, options: RequestOptions = {}): Promise<void> {
    return this.http.request<void>({
      method: 'DELETE',
      path: `${AUTH_PATHS.sessions}/${encodeURIComponent(sessionId)}`,
      ...this.requestOptions(options),
    });
  }

  /** Завершает все сессии, кроме текущей. */
  revokeOtherSessions(options: RequestOptions = {}): Promise<void> {
    return this.http.request<void>({
      method: 'DELETE',
      path: AUTH_PATHS.sessions,
      ...this.requestOptions(options),
    });
  }
}
