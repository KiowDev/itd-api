import type { UserId } from '../models/common.js';
import type { AuthInput, CredentialsAuth } from '../types/options.js';
import type { AuthConfig } from './config.js';
import {
  AUTH_FLAG_COOKIE,
  type CookieJar,
  REFRESH_COOKIE,
  REFRESH_COOKIE_PATH,
} from './cookies.js';
import { Emitter, reportListenerError } from './emitter.js';
import { ItdApiError, ItdAuthError, ItdConfigError } from './errors.js';
import { readTokenIdentity, readTokenSubject } from './jwt.js';
import { operationMethod } from './operations.js';
import type { RequestHandler } from './pipeline.js';
import { createDeviceId } from './runtime.js';
import { copySession, type ItdSession } from './storage.js';

/** Пути эндпоинтов авторизации. */
export const AUTH_PATHS = {
  signUp: '/api/v1/auth/sign-up',
  signIn: '/api/v1/auth/sign-in',
  verifyOtp: '/api/v1/auth/verify-otp',
  resendOtp: '/api/v1/auth/resend-otp',
  refresh: '/api/v1/auth/refresh',
  logout: '/api/v1/auth/logout',
  forgotPassword: '/api/v1/auth/forgot-password',
  resetPassword: '/api/v1/auth/reset-password',
  changePassword: '/api/v1/auth/change-password',
  sessions: '/api/v1/auth/sessions',
} as const;

/**
 * Публичный ключ Cloudflare Turnstile платформы итд.com.
 *
 * Нужен, чтобы отрисовать виджет капчи и получить токен для `signIn`, `signUp`
 * и `forgotPassword`.
 *
 * @example
 * ```ts
 * turnstile.render('#captcha', {
 *   sitekey: TURNSTILE_SITE_KEY,
 *   callback: (turnstileToken) => itd.auth.signIn({ email, password, turnstileToken }),
 * });
 * ```
 */
export const TURNSTILE_SITE_KEY = '0x4AAAAAACHhxczw6fJGwPBg';

/** Заголовок с идентификатором устройства. Сервер связывает с ним запись в списке сессий. */
export const DEVICE_ID_HEADER = 'X-Device-Id';

/** События слоя авторизации. */
export interface AuthEvents {
  /** Токен получен или обновлён. */
  tokens: { accessToken: string };
  /** Выполнен вход. */
  signIn: { accessToken: string };
  /** Сессия очищена — вручную или из-за неудачного обновления. */
  signOut: undefined;
  /** Обновить сессию не удалось; дальнейшие запросы будут падать с 401. */
  authError: { error: unknown };
}

/** Ответ эндпоинтов, выдающих токен. */
interface TokenResponse {
  accessToken?: unknown;
}

function readAccessToken(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const token = (payload as TokenResponse).accessToken;
  return typeof token === 'string' && token.length > 0 ? token : undefined;
}

/** Убирает поле, которое сохраняли промежуточные версии с поддержкой `getUserId()`. */
function withoutLegacyUserId(session: ItdSession): ItdSession {
  const clean = { ...session };
  delete (clean as ItdSession & { userId?: unknown }).userId;
  return clean;
}

let authScopeSequence = 0;

function nextAuthScope(): string {
  authScopeSequence += 1;
  return String(authScopeSequence);
}

/** Области аккаунта и конкретной сессии для локального состояния плагинов. */
export interface AuthIdentity {
  /** Идентификатор пользователя; отсутствует у непрозрачного или повреждённого токена. */
  userId?: UserId | undefined;
  /** Идентификатор серверной сессии; отсутствует у непрозрачного или повреждённого токена. */
  sessionId?: string | undefined;
}

interface AuthManagerHooks {
  /** Вызывается синхронно перед заменой владельца авторизации. */
  onAccountChange?: (() => void) | undefined;
}

/**
 * Хранит сессию и продлевает её.
 *
 * Главное здесь — **дедупликация обновления**. Когда десять параллельных запросов
 * одновременно получают `401`, обновление должно произойти один раз, а остальные обязаны
 * дождаться его результата. Иначе сервер увидит десять параллельных `refresh`, и все,
 * кроме первого, скорее всего получат отказ по уже использованному токену.
 */
export class AuthManager {
  readonly #config: AuthConfig;
  readonly #send: RequestHandler;
  readonly #jar: CookieJar;
  readonly #emitter: Emitter<AuthEvents>;
  readonly #hooks: AuthManagerHooks;

  /** `undefined` — сессия ещё не читалась из хранилища. */
  #session: ItdSession | null | undefined;
  /**
   * Общий промис чтения сессии из хранилища. Дедупликация: параллельные запросы на холодном
   * старте читают хранилище один раз и не заводят каждый свой `deviceId`.
   */
  #loading: Promise<ItdSession | null> | null = null;
  /** Общий промис обновления: к нему присоединяются все, кто получил 401. */
  #refreshing: Promise<string | null> | null = null;
  /** Общий промис входа по логину и паролю. */
  #signingIn: Promise<string> | null = null;
  /** Fallback-область для изоляции состояния плагинов, когда JWT-идентичность недоступна. */
  #authScope = nextAuthScope();
  /** Последний токен внешнего источника; `undefined` означает, что источник ещё не читался. */
  #externalToken: string | null | undefined;
  /** Идентификаторы последнего токена внешнего источника для синхронных потребителей. */
  #externalIdentity: AuthIdentity | undefined;
  /**
   * Идентификатор устройства.
   *
   * Держится отдельно от сессии намеренно: выход из аккаунта не меняет устройство,
   * поэтому `clear()` его не трогает.
   */
  #deviceId: string | undefined;
  /** Общий промис первичной выдачи `deviceId` — чтобы параллельные запросы получили один. */
  #deviceIdLoading: Promise<string> | null = null;
  /**
   * Счётчик смен владельца авторизации.
   *
   * Растёт при каждой операции, которая заменяет или очищает сессию извне: `clear`,
   * `setSession`, `setAccessToken`, вход. `#performRefresh` снимает его значение перед
   * сетевым запросом и сверяет перед записью — иначе запоздавший ответ обновления мог бы
   * воскресить уже очищенную сессию поверх `signOut`.
   */
  #authEpoch = 0;

  constructor(
    config: AuthConfig,
    send: RequestHandler,
    jar: CookieJar,
    hooks: AuthManagerHooks = {},
  ) {
    this.#config = config;
    this.#send = send;
    this.#jar = jar;
    this.#hooks = hooks;
    this.#emitter = new Emitter<AuthEvents>((error) =>
      reportListenerError(config.logger, 'авторизации', error),
    );
  }

  /** Подписка на события авторизации. */
  get on(): Emitter<AuthEvents>['on'] {
    return this.#emitter.on.bind(this.#emitter);
  }

  /** Подписка на одно срабатывание. */
  get once(): Emitter<AuthEvents>['once'] {
    return this.#emitter.once.bind(this.#emitter);
  }

  /** Снимает lifecycle-подписки при терминальном освобождении владельца. @internal */
  dispose(): void {
    this.#invalidateInFlight();
    this.#emitter.removeAllListeners();
  }

  /**
   * Непрозрачная fallback-область авторизации.
   *
   * Изолирует состояние плагинов, когда идентичность аккаунта из JWT недоступна (непрозрачный
   * токен): значение уникально для владельца и сменяется при замене или очистке сессии.
   */
  getAuthScope(): string {
    return this.#authScope;
  }

  /** Загружает сессию и возвращает идентификаторы аккаунта и сессии для плагинов. */
  async getAuthIdentity(): Promise<AuthIdentity> {
    const session = await this.#loadSession();
    if (session?.accessToken) return this.#identityForToken(session.accessToken);

    const auth = this.#config.auth;
    if (typeof auth === 'object' && auth !== null && 'getToken' in auth) {
      const token = await this.#readExternalToken(() => auth.getToken());
      return this.#identityForToken(token ?? undefined);
    }

    return {};
  }

  /** Идентификаторы аккаунта и сессии без чтения хранилища. @internal */
  getCurrentAuthIdentity(): AuthIdentity {
    const session =
      this.#session === undefined ? this.#sessionFromConfig(this.#config.auth) : this.#session;
    return session?.accessToken
      ? this.#identityForToken(session.accessToken)
      : (this.#externalIdentity ?? {});
  }

  #rotateAuthScope(): void {
    this.#authScope = nextAuthScope();
  }

  /** Отмечает смену владельца авторизации — обесценивает результат идущего обновления. */
  #invalidateInFlight(): void {
    this.#authEpoch += 1;
  }

  #identityForToken(accessToken: string | undefined): AuthIdentity {
    const token = accessToken ? readTokenIdentity(accessToken) : {};
    return {
      ...(token.subject ? { userId: token.subject as UserId } : {}),
      ...(token.sessionId ? { sessionId: token.sessionId } : {}),
    };
  }

  async #readExternalToken(
    getToken: () => string | null | Promise<string | null>,
  ): Promise<string | null> {
    const token = (await getToken()) ?? null;
    const current = this.#identityForToken(token ?? undefined);

    if (this.#externalToken !== undefined && this.#externalToken !== token) {
      this.#rotateAuthScope();
      const previous = this.#externalIdentity ?? {};
      const changed =
        previous.userId !== undefined && current.userId !== undefined
          ? previous.userId !== current.userId
          : true;
      if (changed) this.#hooks.onAccountChange?.();
    }

    this.#externalToken = token;
    this.#externalIdentity = current;
    return token;
  }

  /** Меняет fallback и завершает realtime, только если фактически сменился аккаунт. */
  #transitionAuth(accessToken: string | undefined, rotateFallback = true): void {
    const knownPrevious = this.#session !== undefined;
    const previous = this.#identityForToken(this.#session?.accessToken);
    const current = this.#identityForToken(accessToken);
    const changed =
      previous.userId !== undefined && current.userId !== undefined
        ? previous.userId !== current.userId
        : previous.userId !== current.userId || rotateFallback;

    if (rotateFallback || changed) this.#rotateAuthScope();
    if (knownPrevious && changed) this.#hooks.onAccountChange?.();
  }

  /**
   * Есть ли признак живой refresh-сессии.
   *
   * Рядом с refresh-токеном сервер ставит незакрытую cookie `is_auth` — по ней видно,
   * что продлевать сессию вообще есть смысл, и API не дёргается у анонимов.
   * В браузере cookie ведёт сама среда, поэтому там ответ всегда `true`.
   *
   * Асинхронный, потому что признак может лежать в {@link TokenStorage}: до чтения оттуда
   * ответ был бы `false` даже при полностью рабочей сохранённой сессии.
   */
  async hasRefreshSession(): Promise<boolean> {
    await this.#loadSession();
    return this.#hasRefreshSession();
  }

  /** То же самое, но без чтения хранилища — для вызовов, где сессия уже загружена. */
  #hasRefreshSession(): boolean {
    if (!this.#config.useCookieJar) return true;
    // Флаг должен принадлежать основному API, а не другому сервису.
    if (this.#jar.has(AUTH_FLAG_COOKIE, this.#config.baseUrl)) return true;

    // Явно переданный refresh-токен — тоже основание пробовать.
    return Boolean(this.#session?.refreshToken);
  }

  /** Заголовки авторизации для очередного запроса. Пустой объект, если токена нет. */
  async getAuthHeaders(): Promise<Record<string, string>> {
    const token = await this.getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  /**
   * Заголовки уже подготовленной авторизации без чтения storage или вызова внешнего источника.
   *
   * Используются после ожидания транспортной очереди: к этому моменту `getAccessToken()` уже
   * был вызван снаружи неё, но token мог успеть смениться из-за refresh или `setSession()`.
   *
   * @internal
   */
  getCurrentAuthHeaders(): Record<string, string> {
    const session =
      this.#session === undefined ? this.#sessionFromConfig(this.#config.auth) : this.#session;
    const token = session?.accessToken ?? this.#externalToken ?? null;
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  /**
   * Идентификатор устройства для заголовка `X-Device-Id`.
   *
   * Заводится один раз и сохраняется в сессии, чтобы пережить перезапуск процесса:
   * сервер связывает с ним запись в списке сессий, и плавающее значение плодило бы
   * по новой сессии на каждый старт.
   */
  getDeviceId(): Promise<string> {
    if (this.#deviceId) return Promise.resolve(this.#deviceId);

    // Дедупликация: параллельные вызовы на холодном клиенте получают один `X-Device-Id`.
    this.#deviceIdLoading ??= this.#resolveDeviceId().finally(() => {
      this.#deviceIdLoading = null;
    });

    return this.#deviceIdLoading;
  }

  async #resolveDeviceId(): Promise<string> {
    const session = await this.#loadSession();
    const deviceId = this.#config.deviceId ?? session?.deviceId ?? createDeviceId();

    this.#deviceId = deviceId;

    // Записываем, только если значение действительно новое, — иначе каждый первый запрос
    // дёргал бы хранилище без всякой пользы.
    if (session?.deviceId !== deviceId) {
      await this.#saveSession({ ...(session ?? {}), deviceId });
    }

    return deviceId;
  }

  /**
   * Текущий токен доступа.
   *
   * При необходимости выполняет отложенный вход: если в конфигурации переданы логин
   * и пароль, первый же запрос сам заведёт сессию.
   */
  async getAccessToken(): Promise<string | null> {
    const session = await this.#loadSession();
    if (session?.accessToken) return session.accessToken;

    const auth = this.#config.auth;
    if (!auth) return null;

    // Внешний источник токена спрашиваем каждый раз: он сам решает, когда обновлять.
    if (typeof auth === 'object' && 'getToken' in auth) {
      return this.#readExternalToken(() => auth.getToken());
    }

    if (typeof auth === 'object' && 'email' in auth) {
      return this.#signInWithCredentials(auth);
    }

    return null;
  }

  /**
   * Реакция транспорта на ответ `401`.
   *
   * @returns `true`, если токен обновлён и запрос имеет смысл повторить
   */
  async onUnauthorized(): Promise<boolean> {
    try {
      const token = await this.#refreshDeduplicated();
      if (token !== null) return true;

      // Обновлять нечем — это тоже отказ авторизации, и подписчик должен о нём узнать.
      this.#emitter.emit('authError', { error: this.#noRefreshSessionError() });
      return false;
    } catch (error) {
      this.#emitter.emit('authError', { error });
      return false;
    }
  }

  /**
   * Ошибка «сессию продлить нечем».
   *
   * Возникает, только когда обновление даже не начиналось: нет ни cookie `is_auth`,
   * ни refresh-токена. Если сервер ответил отказом, наружу уходит **его** ошибка —
   * подменять её этой значило бы прятать причину (`REFRESH_TOKEN_MISSING`,
   * `SESSION_NOT_FOUND`, `SESSION_REVOKED` — разные поводы и разные действия).
   */
  #noRefreshSessionError(): ItdAuthError {
    return new ItdAuthError({
      status: 401,
      code: 'SESSION_EXPIRED',
      message:
        'Не удалось обновить сессию: нет ни cookie is_auth, ни refresh-токена. ' +
        'Войдите заново либо передайте refreshToken в auth.',
      method: 'POST',
      path: AUTH_PATHS.refresh,
      raw: undefined,
    });
  }

  /**
   * Обновляет токен доступа.
   *
   * Параллельные вызовы объединяются в один сетевой запрос.
   *
   * @throws {ItdAuthError} если обновить сессию не удалось
   */
  async refresh(): Promise<string> {
    const token = await this.#refreshDeduplicated();
    if (token === null) throw this.#noRefreshSessionError();
    return token;
  }

  /** Сохраняет токен, полученный извне, — например после подтверждения OTP. */
  async setAccessToken(accessToken: string): Promise<void> {
    await this.#loadSession();
    this.#invalidateInFlight();
    this.#transitionAuth(accessToken);
    await this.#saveSession({
      ...(this.#session ?? {}),
      accessToken,
      obtainedAt: this.#config.clock.now(),
    });
    this.#emitter.emit('tokens', { accessToken });
  }

  /** Текущая сессия целиком. Полезно, чтобы сохранить её самому. */
  async getSession(): Promise<ItdSession | null> {
    const session = await this.#loadSession();
    return session ? copySession(session) : null;
  }

  /**
   * Идентификатор владельца сессии.
   *
   * Считается непосредственно из текущего токена и отдельно не сохраняется: после замены
   * токена идентификатор прежнего владельца остаться не может.
   */
  async getUserId(): Promise<UserId | undefined> {
    const session = await this.#loadSession();
    return session?.accessToken ? readTokenSubject(session.accessToken) : undefined;
  }

  /** Заменяет сессию и связанные с ней cookie целиком. */
  async setSession(session: ItdSession): Promise<void> {
    await this.#loadSession();
    this.#invalidateInFlight();
    this.#transitionAuth(session.accessToken);
    this.#jar.clear();
    this.#jar.deserialize(session.cookies);

    if (session.deviceId) this.#deviceId = session.deviceId;

    // Refresh-cookie добавляется до сериализации сессии.
    this.#session = session;
    this.#seedRefreshCookie();

    await this.#saveSession(session);
  }

  /**
   * Забывает сессию и cookie. Сетевой запрос не выполняется.
   *
   * Идентификатор устройства выход переживает: иначе каждая пара «выход — вход» плодила бы
   * новую запись в списке сессий.
   */
  async clear(): Promise<void> {
    await this.#loadSession();
    this.#invalidateInFlight();
    this.#transitionAuth(undefined);
    this.#session = null;
    this.#jar.clear();
    await this.#config.storage.clear();

    if (this.#deviceId) await this.#saveSession({ deviceId: this.#deviceId });

    this.#emitter.emit('signOut', undefined);
  }

  #loadSession(): Promise<ItdSession | null> {
    if (this.#session !== undefined) return Promise.resolve(this.#session);

    this.#loading ??= this.#performLoad().finally(() => {
      this.#loading = null;
    });

    return this.#loading;
  }

  async #performLoad(): Promise<ItdSession | null> {
    const loaded = (await this.#config.storage.get()) ?? null;
    const stored = loaded ? withoutLegacyUserId(loaded) : null;

    // Восстанавливаем cookie: без них не выйдет обновить токен после перезапуска процесса.
    if (stored?.cookies) this.#jar.deserialize(stored.cookies);

    const fromConfig = this.#sessionFromConfig(this.#config.auth);

    // Хранилище отвечает за состояние сессии и всегда важнее, но недостающие поля
    // берутся из конфигурации: типичный случай — сохранён только accessToken,
    // а refresh-токен приходит из настроек приложения.
    this.#session =
      stored && fromConfig
        ? {
            ...stored,
            accessToken: stored.accessToken ?? fromConfig.accessToken,
            refreshToken: stored.refreshToken ?? fromConfig.refreshToken,
          }
        : (stored ?? fromConfig);

    this.#seedRefreshCookie();

    return this.#session;
  }

  /**
   * Кладёт refresh-токен в jar как cookie `refresh_token`.
   *
   * `POST /api/v1/auth/refresh` читает токен только из cookie, поэтому переданный строкой
   * приходится превращать в неё. В браузере это невозможно — cookie помечена `HttpOnly`,
   * и там обновление работает только на той, что поставил сам сервер.
   */
  #seedRefreshCookie(): void {
    if (!this.#config.useCookieJar) return;

    const refreshToken = this.#session?.refreshToken;
    if (!refreshToken) return;
    if (this.#jar.has(REFRESH_COOKIE)) return;

    this.#jar.set(this.#config.baseUrl, REFRESH_COOKIE, refreshToken, REFRESH_COOKIE_PATH);
  }

  #sessionFromConfig(auth: AuthInput | undefined): ItdSession | null {
    if (!auth) return null;
    if (typeof auth === 'string') {
      return { accessToken: auth, obtainedAt: this.#config.clock.now() };
    }

    if ('accessToken' in auth) {
      return {
        accessToken: auth.accessToken,
        refreshToken: auth.refreshToken,
        obtainedAt: this.#config.clock.now(),
      };
    }

    return null;
  }

  async #saveSession(session: ItdSession): Promise<void> {
    const cookies = this.#config.useCookieJar ? this.#jar.serialize() : undefined;
    const deviceId = session.deviceId ?? this.#deviceId;

    const next = withoutLegacyUserId({
      ...session,
      ...(cookies?.length ? { cookies } : {}),
      ...(deviceId ? { deviceId } : {}),
    });

    this.#session = next;
    await this.#config.storage.set(next);
  }

  /**
   * Обновление с дедупликацией.
   *
   * Все, кто пришёл, пока обновление уже идёт, получают его результат, а не запускают своё.
   */
  #refreshDeduplicated(): Promise<string | null> {
    if (this.#refreshing) return this.#refreshing;

    const promise = this.#performRefresh().finally(() => {
      this.#refreshing = null;
    });

    this.#refreshing = promise;
    return promise;
  }

  async #performRefresh(): Promise<string | null> {
    await this.#loadSession();

    if (!this.#hasRefreshSession()) {
      // Нет признаков сессии — обновлять нечего. При наличии логина и пароля
      // пробуем войти заново.
      return this.#reloginOrNull();
    }

    // Снимок владельца авторизации: если он сменится, пока идёт сетевой запрос,
    // результат обновления записывать нельзя.
    const epoch = this.#authEpoch;

    try {
      // Служебный запрос идёт через общий pipeline. Слой авторизации он пропускает, чтобы
      // не отправлять устаревший Bearer и не запускать рекурсивный refresh. Очередь безопасна:
      // исходная неудачная транспортная попытка освободила свой слот до вызова этого метода.
      const payload = await this.#send({
        operationId: 'auth.refresh',
        method: operationMethod('auth.refresh'),
        path: AUTH_PATHS.refresh,
        skipAuth: true,
        skipAuthRefresh: true,
        // Тела нет намеренно: сервер читает refresh-токен только из cookie — см.
        // #seedRefreshCookie. По той же причине не нужен и устаревший Bearer.
      });

      const accessToken = readAccessToken(payload);
      if (!accessToken) return this.#reloginOrNull();

      if (this.#authEpoch !== epoch) {
        // Пока шёл refresh, владельца сменили (signOut / setSession / вход): его результат
        // устарел. Не воскрешаем сохранённую сессию, отдаём актуальный токен как есть.
        return this.#session?.accessToken ?? null;
      }

      // Сервер выдаёт при обновлении **новый** refresh-токен (`Set-Cookie: refresh_token=…;
      // Max-Age=2592000`) и тут же гасит прежний. Забрать его из jar обязательно: иначе
      // сохранённая строка протухнет и восстановление сессии из хранилища перестанет работать.
      const rotated = this.#jar.getValue(
        REFRESH_COOKIE,
        this.#config.baseUrl + REFRESH_COOKIE_PATH,
      );

      // Refresh продолжает ту же серверную сессию. Для непрозрачного токена это единственная
      // надёжная возможность сохранить scope; смена пользователя в JWT всё равно будет обнаружена.
      this.#transitionAuth(accessToken, false);
      await this.#saveSession({
        ...(this.#session ?? {}),
        accessToken,
        ...(rotated ? { refreshToken: rotated } : {}),
        obtainedAt: this.#config.clock.now(),
      });

      this.#emitter.emit('tokens', { accessToken });
      return accessToken;
    } catch (error) {
      if (error instanceof ItdApiError) {
        if (this.#authEpoch !== epoch) {
          // Владельца сменили, пока шёл refresh: ошибка относится к уже забытой сессии —
          // не трогаем актуальное состояние.
          return this.#session?.accessToken ?? null;
        }

        // Сессия недействительна — чистим её, иначе будем биться в стену на каждом запросе.
        this.#transitionAuth(undefined);
        this.#session = null;
        this.#jar.clear();
        await this.#config.storage.clear();

        const relogged = await this.#reloginOrNull();
        if (relogged !== null) return relogged;

        // Войти заново нечем — отдаём ошибку сервера как есть. Именно она объясняет,
        // что произошло: REFRESH_TOKEN_MISSING, SESSION_NOT_FOUND, SESSION_REVOKED.
        throw error;
      }
      throw error;
    }
  }

  /** Повторный вход, если разрешён настройкой и есть логин с паролем. */
  async #reloginOrNull(): Promise<string | null> {
    const auth = this.#config.auth;

    if (
      !this.#config.reloginOnRefreshFailure ||
      !auth ||
      typeof auth !== 'object' ||
      !('email' in auth)
    ) {
      return null;
    }

    try {
      return await this.#signInWithCredentials(auth);
    } catch {
      return null;
    }
  }

  /**
   * Вход по логину и паролю.
   *
   * Параллельные вызовы объединяются: одновременный старт нескольких запросов не должен
   * приводить к нескольким попыткам входа и блокировке аккаунта.
   */
  #signInWithCredentials(credentials: CredentialsAuth): Promise<string> {
    if (this.#signingIn) return this.#signingIn;

    const promise = this.#performSignIn(credentials).finally(() => {
      this.#signingIn = null;
    });

    this.#signingIn = promise;
    return promise;
  }

  /**
   * Берёт токен капчи для входа.
   *
   * `getTurnstileToken` приоритетнее готовой строки: токен Turnstile одноразовый и живёт
   * несколько минут, поэтому при повторном входе через сутки годится только свежий.
   */
  async #resolveTurnstileToken(credentials: CredentialsAuth): Promise<string> {
    if (credentials.getTurnstileToken) {
      const token = await credentials.getTurnstileToken();
      if (token) return token;
    }

    if (credentials.turnstileToken) return credentials.turnstileToken;

    throw new ItdConfigError(
      'Вход по email и паролю требует токен капчи Cloudflare Turnstile: без него сервер ' +
        'отвечает 422. Передайте auth.getTurnstileToken (источник свежего токена) либо ' +
        'разовый auth.turnstileToken. Ключ виджета — TURNSTILE_SITE_KEY. В Node токен умеет ' +
        'добывать отдельный пакет: npm i @itd-api/turnstile, затем ' +
        'getTurnstileToken: createTurnstileSolver().',
    );
  }

  async #performSignIn(credentials: CredentialsAuth): Promise<string> {
    const turnstileToken = await this.#resolveTurnstileToken(credentials);

    // Через общий pipeline: плагины, повторы и очередь сохраняются, а слой авторизации
    // пропускается, потому что токена ещё нет.
    const payload = await this.#send({
      operationId: 'auth.signIn',
      method: operationMethod('auth.signIn'),
      path: AUTH_PATHS.signIn,
      body: { email: credentials.email, password: credentials.password, turnstileToken },
      skipAuth: true,
      skipAuthRefresh: true,
    });

    const accessToken = readAccessToken(payload);

    if (!accessToken) {
      // Сервер запросил подтверждение по коду — автоматически это не пройти.
      throw new ItdConfigError(
        'Вход по email и паролю требует подтверждения кодом из письма. Автоматический вход ' +
          'невозможен: воспользуйтесь itd.auth.signInWithOtp() и передайте полученный ' +
          'accessToken в конфигурацию клиента.',
      );
    }

    // Прежний refresh-токен и cookie намеренно не переносятся: вход выдал новую сессию,
    // и держаться за старую было бы ошибкой. Идентификатор устройства добавит #saveSession.
    this.#invalidateInFlight();
    this.#transitionAuth(accessToken);
    await this.#saveSession({ accessToken, obtainedAt: this.#config.clock.now() });
    this.#emitter.emit('tokens', { accessToken });
    this.#emitter.emit('signIn', { accessToken });

    return accessToken;
  }
}
