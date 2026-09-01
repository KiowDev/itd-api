import type { ClientConnection } from '../core/connection.js';
import type { CookieJar } from '../core/cookies.js';
import { ItdConfigError, isItdApiError } from '../core/errors.js';
import type { HttpClient } from '../core/execution/http.js';
import type { RequestOptions } from '../core/options.js';
import type { QrLoginTarget, Session } from '../models/account.js';
import type { AuthState } from '../models/users.js';
import {
  AUTH_CAPTCHA_PAGE,
  AUTH_CAPTCHA_PROVIDER,
  AUTH_CHANGE_PASSWORD,
  AUTH_CHECK,
  AUTH_FORGOT_PASSWORD,
  AUTH_LOGOUT,
  AUTH_QR_APPROVE,
  AUTH_QR_CLAIM,
  AUTH_QR_REJECT,
  AUTH_QR_SCAN,
  AUTH_QR_START,
  AUTH_RESEND_OTP,
  AUTH_RESET_PASSWORD,
  AUTH_REVOKE_OTHER_SESSIONS,
  AUTH_REVOKE_SESSION,
  AUTH_SESSIONS,
  AUTH_SIGN_IN,
  AUTH_SIGN_UP,
  AUTH_VERIFY_OTP,
  type CaptchaPage,
  type CaptchaProvider,
  type CaptchaToken,
  type QrLoginClaim,
  type QrLoginStart,
  QrLoginStatus,
  type QrLoginStreamEvent,
  QrLoginStreamStatus,
  type SignInResult,
  SignInStatus,
} from '../operations/auth.js';
import { AUTH_PATHS, type AuthManager } from '../session/auth.js';
import { openQrLoginStream } from '../session/qr-stream.js';
import { BaseResource } from './base.js';

/** Учётные данные для входа. */
export interface Credentials {
  email: string;
  password: string;
}

/**
 * Учётные данные вместе с токеном капчи.
 *
 * Токен нужен, только когда у клиента не задана опция `captcha`: с ней клиент получает его
 * сам. Какой виджет сейчас требует сервер, сообщает {@link AuthResource.captchaProvider};
 * в Node токен добывает `@itd-api/captcha`. Токен одноразовый и живёт несколько минут.
 *
 * @example
 * ```ts
 * const { provider, field } = await itd.auth.captchaProvider();
 * const token = await solveCaptcha(provider);
 *
 * await itd.auth.signIn({ email, password, captcha: { type: provider, token, field } });
 * ```
 */
export type CredentialsWithCaptcha = Credentials & { captcha?: CaptchaToken | undefined };

/** Запрос письма для сброса пароля. Капча обязательна, как и при входе. */
export interface ForgotPasswordInput {
  email: string;
  captcha?: CaptchaToken | undefined;
}

/** Секреты QR-сессии и капча для завершения входа. */
export interface QrLoginClaimInput {
  qrId: string;
  claimToken: string;
  captcha?: CaptchaToken | undefined;
}

/** Секреты QR-сессии для потокового наблюдения. */
export interface QrLoginStreamInput {
  qrId: string;
  claimToken: string;
}

/**
 * Секреты QR-кода со стороны сканирующего устройства.
 *
 * Оба значения лежат во fragment {@link QrLoginStart.payload} — ссылки вида
 * `https://итд.com/qr#i=<qrId>&s=<secret>`, которую и кодирует QR-код. `secret` — не то же
 * самое, что `claimToken`: этот секрет предъявляет тот, кто сканирует, а `claimToken` — тот,
 * кто код показывает.
 */
export interface QrLoginSecrets {
  qrId: string;
  secret: string;
}

/** Управление временем жизни потокового запроса. */
export interface QrLoginStreamOptions {
  signal?: AbortSignal | undefined;
}

/** Обработчик одного события QR-потока. */
export type QrLoginStreamListener = (event: QrLoginStreamEvent) => void | Promise<void>;

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

export type { QrLoginTarget } from '../models/account.js';
export type {
  CaptchaPage,
  CaptchaProvider,
  CaptchaToken,
  QrLoginClaim,
  QrLoginStart,
  QrLoginStreamEvent,
  SignInResult,
  SignInStatus as SignInStatusValue,
} from '../operations/auth.js';
/** Состояния обычного входа и QR-входа. */
export {
  CAPTCHA_FIELDS,
  QrLoginStatus,
  QrLoginStreamStatus,
  SignInStatus,
} from '../operations/auth.js';

interface QrCookieFlow {
  cookies: CookieJar;
  expiresAt: number | undefined;
  /** Сервер потребовал капчу для этой сессии — в ответе `start` либо на прошлой проверке. */
  captchaRequired: boolean;
}

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
  readonly #connection: ClientConnection;
  readonly #qrFlows = new Map<string, QrCookieFlow>();

  constructor(http: HttpClient, deps: { auth: AuthManager; connection: ClientConnection }) {
    super(http);
    this.#auth = deps.auth;
    this.#connection = deps.connection;
  }

  #pruneQrFlows(): void {
    const now = this.#connection.clock.now();
    for (const [qrId, flow] of this.#qrFlows) {
      if (flow.expiresAt !== undefined && flow.expiresAt <= now) this.#qrFlows.delete(qrId);
    }
  }

  #qrFlow(qrId: string): QrCookieFlow {
    this.#pruneQrFlows();
    const existing = this.#qrFlows.get(qrId);
    if (existing) return existing;
    const flow = {
      cookies: this.#auth.createCookieFlow(false),
      expiresAt: undefined,
      captchaRequired: false,
    };
    this.#qrFlows.set(qrId, flow);
    return flow;
  }

  #touchQrFlow(flow: QrCookieFlow, expiresIn: number | undefined): void {
    if (typeof expiresIn !== 'number' || !Number.isFinite(expiresIn)) return;
    const expiresAt = this.#connection.clock.now() + Math.max(0, expiresIn) * 1_000;
    flow.expiresAt = flow.expiresAt === undefined ? expiresAt : Math.min(flow.expiresAt, expiresAt);
  }

  #forgetTerminalQrError(qrId: string, error: unknown): void {
    if (
      isItdApiError(error) &&
      error.hasCode('QR_EXPIRED', 'QR_ALREADY_USED', 'QR_TOKEN_MISMATCH')
    ) {
      this.#qrFlows.delete(qrId);
    }
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
   * Узнаёт активного провайдера капчи и поле токена.
   *
   * Сервер может переключить провайдера или переименовать поле без выпуска новой версии SDK.
   * Автоматическому входу этот вызов не нужен — клиент делает его сам.
   */
  captchaProvider(options: RequestOptions = {}): Promise<CaptchaProvider> {
    return this.http.execute(AUTH_CAPTCHA_PROVIDER, {
      path: AUTH_PATHS.captchaProvider,
      skipAuth: true,
      skipAuthRefresh: true,
      ...options,
    });
  }

  /**
   * Узнаёт активного провайдера капчи вместе с адресом страницы виджета.
   *
   * То же, что {@link captchaProvider}, плюс `url` — готовая страница на домене итд.com,
   * где ключ виджета действителен. Пригодится встроенному браузеру: открыть её и забрать
   * токен, ничего не собирая самому.
   */
  captchaPage(options: RequestOptions = {}): Promise<CaptchaPage> {
    return this.http.execute(AUTH_CAPTCHA_PAGE, {
      path: AUTH_PATHS.captchaPage,
      skipAuth: true,
      skipAuthRefresh: true,
      ...options,
    });
  }

  /** Создаёт короткоживущую сессию QR-входа. */
  async startQrLogin(options: RequestOptions = {}): Promise<QrLoginStart> {
    const cookies = this.#auth.createCookieFlow(false);
    const result = await this.http.execute(AUTH_QR_START, {
      path: AUTH_PATHS.qrStart,
      skipAuth: true,
      skipAuthRefresh: true,
      cookieJar: cookies,
      ...options,
    });
    if (typeof result.qrId === 'string' && result.qrId !== '') {
      const flow = { cookies, expiresAt: undefined, captchaRequired: false };
      this.#touchQrFlow(flow, result.expiresIn);
      this.#qrFlows.set(result.qrId, flow);
    }
    return result;
  }

  /**
   * Проверяет QR-сессию и завершает вход после подтверждения на другом устройстве.
   *
   * До подтверждения возвращает промежуточный статус. Токен капчи добывается, только когда
   * сервер о ней попросил — статусом `captcha_required` на прошлой проверке, — либо когда
   * передан в сам вызов. Полученный `accessToken` автоматически сохраняется в клиенте.
   */
  async claimQrLogin(
    input: QrLoginClaimInput,
    options: RequestOptions = {},
  ): Promise<QrLoginClaim> {
    const revision = this.#auth.revision();
    const flow = this.#qrFlow(input.qrId);
    try {
      const { captcha, ...rest } = input;
      const needsCaptcha = captcha !== undefined || flow.captchaRequired;
      const result = await this.http.execute(AUTH_QR_CLAIM, {
        path: AUTH_PATHS.qrClaim,
        body: { ...rest, ...(needsCaptcha ? await this.#auth.captchaBody(captcha) : {}) },
        skipAuth: true,
        skipAuthRefresh: true,
        cookieJar: flow.cookies,
        ...options,
      });

      this.#touchQrFlow(flow, result.expiresIn);
      if (result.status === QrLoginStatus.CaptchaRequired) flow.captchaRequired = true;
      if (result.status === QrLoginStatus.Authorized) {
        await this.#auth.commitAuthFlow(result.accessToken, flow.cookies, revision);
        this.#qrFlows.delete(input.qrId);
      } else if (result.status === QrLoginStatus.Rejected) {
        this.#qrFlows.delete(input.qrId);
      }
      return result;
    } catch (error) {
      this.#forgetTerminalQrError(input.qrId, error);
      throw error;
    }
  }

  /**
   * Слушает состояния QR-входа до закрытия ответа или отмены `signal`.
   *
   * Событие `approved` означает, что подтверждение завершено: после него вызовите
   * {@link claimQrLogin}, чтобы получить и сохранить access token.
   */
  async streamQrLogin(
    input: QrLoginStreamInput,
    onEvent: QrLoginStreamListener,
    options: QrLoginStreamOptions = {},
  ): Promise<void> {
    if (typeof onEvent !== 'function') {
      throw new ItdConfigError('onEvent QR-потока должен быть функцией');
    }

    const flow = this.#qrFlow(input.qrId);
    try {
      await openQrLoginStream(
        this.#connection,
        flow.cookies,
        input,
        async (event) => {
          this.#touchQrFlow(flow, event.expiresIn);
          if (event.status === QrLoginStreamStatus.Rejected) this.#qrFlows.delete(input.qrId);
          await onEvent(event);
        },
        options.signal,
      );
    } catch (error) {
      this.#forgetTerminalQrError(input.qrId, error);
      throw error;
    }
  }

  /**
   * Отмечает QR-код отсканированным и узнаёт, кого впускают.
   *
   * Обратная сторона QR-входа: этот и два соседних метода вызывает устройство, где сессия
   * уже есть. Показывающая сторона увидит статус `scanned`, но вход ещё не состоится —
   * его завершают {@link approveQrLogin} или {@link rejectQrLogin}.
   *
   * Сервер принимает только сессию, созданную мобильным клиентом. Обычный web access token
   * отклоняется с кодом `QR_APPROVER_NOT_ALLOWED`, даже если добавить мобильные заголовки
   * уже после выдачи токена.
   *
   * @param input секреты из отсканированного кода — см. {@link QrLoginSecrets}
   * @returns описание устройства, которое просит вход
   */
  scanQrLogin(input: QrLoginSecrets, options: RequestOptions = {}): Promise<QrLoginTarget> {
    return this.http.execute(AUTH_QR_SCAN, {
      path: AUTH_PATHS.qrScan,
      body: input,
      ...options,
    });
  }

  /**
   * Подтверждает вход по QR-коду: показавшее код устройство получит access token.
   *
   * Осмысленно после {@link scanQrLogin} — человек должен увидеть, что подтверждает.
   * Требует мобильную сессию, как и `scanQrLogin()`.
   */
  approveQrLogin(input: QrLoginSecrets, options: RequestOptions = {}): Promise<void> {
    return this.voidOperation(AUTH_QR_APPROVE, {
      path: AUTH_PATHS.qrApprove,
      body: input,
      ...options,
    });
  }

  /**
   * Отклоняет вход по QR-коду: показавшее код устройство получит статус `rejected`.
   * Требует мобильную сессию, как и `scanQrLogin()`.
   */
  rejectQrLogin(input: QrLoginSecrets, options: RequestOptions = {}): Promise<void> {
    return this.voidOperation(AUTH_QR_REJECT, {
      path: AUTH_PATHS.qrReject,
      body: input,
      ...options,
    });
  }

  /**
   * Регистрирует аккаунт и запускает подтверждение по коду.
   *
   * @returns `flowToken`, который нужно передать в {@link verifyOtp}
   */
  async signUp(credentials: CredentialsWithCaptcha, options: RequestOptions = {}): Promise<string> {
    const { captcha, ...rest } = credentials;
    return this.http.execute(AUTH_SIGN_UP, {
      path: AUTH_PATHS.signUp,
      body: { ...rest, ...(await this.#auth.captchaBody(captcha)) },
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
   * @param credentials email, пароль и токен капчи — см. {@link CredentialsWithCaptcha}
   */
  async signIn(
    credentials: CredentialsWithCaptcha,
    options: RequestOptions = {},
  ): Promise<SignInResult> {
    const { captcha, ...rest } = credentials;
    const revision = this.#auth.revision();
    const cookies = this.#auth.createCookieFlow(false);
    const body = { ...rest, ...(await this.#auth.captchaBody(captcha)) };
    const result = await this.http.execute(AUTH_SIGN_IN, {
      path: AUTH_PATHS.signIn,
      body,
      skipAuth: true,
      skipAuthRefresh: true,
      cookieJar: cookies,
      ...options,
    });

    if (result.status === SignInStatus.Authenticated) {
      await this.#auth.commitAuthFlow(result.accessToken, cookies, revision);
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

    await this.#auth.commitAuthFlow(accessToken, cookies, revision);
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
    input: CredentialsWithCaptcha & { getOtp: () => string | Promise<string> },
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
  async forgotPassword(input: ForgotPasswordInput, options: RequestOptions = {}): Promise<string> {
    return this.http.execute(AUTH_FORGOT_PASSWORD, {
      path: AUTH_PATHS.forgotPassword,
      body: { email: input.email, ...(await this.#auth.captchaBody(input.captcha)) },
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
   *   captcha: { type: provider, token, field },
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
    const { getOtp, newPassword, ...request } = input;
    const flowToken = await this.forgotPassword(request, options);

    const otp = await getOtp();

    await this.resetPassword({ email: input.email, otp, flowToken, newPassword }, options);
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
