import type { AuthInput } from '../types/options.js';
import type { ResolvedConfig } from './config.js';
import { AUTH_FLAG_COOKIE, type CookieJar } from './cookies.js';
import { Emitter } from './emitter.js';
import { ItdApiError, ItdAuthError, ItdConfigError } from './errors.js';
import type { HttpClient } from './http.js';
import type { ItdSession } from './storage.js';

/** Пути авторизации. Вынесены, чтобы не расходиться между модулями. */
export const AUTH_PATHS = {
  signIn: '/api/v1/auth/sign-in',
  refresh: '/api/v1/auth/refresh',
} as const;

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

/**
 * Хранит сессию и продлевает её.
 *
 * Главное здесь — **дедупликация обновления**. Когда десять параллельных запросов
 * одновременно получают `401`, обновление должно произойти один раз, а остальные обязаны
 * дождаться его результата. Иначе сервер увидит десять параллельных `refresh`, и все,
 * кроме первого, скорее всего получат отказ по уже использованному токену.
 */
export class AuthManager {
  readonly #config: ResolvedConfig;
  readonly #http: HttpClient;
  readonly #jar: CookieJar;
  readonly #emitter = new Emitter<AuthEvents>();

  /** `undefined` — сессия ещё не читалась из хранилища. */
  #session: ItdSession | null | undefined;
  /** Общий промис обновления: к нему присоединяются все, кто получил 401. */
  #refreshing: Promise<string | null> | null = null;
  /** Общий промис входа по логину и паролю. */
  #signingIn: Promise<string> | null = null;

  constructor(config: ResolvedConfig, http: HttpClient, jar: CookieJar) {
    this.#config = config;
    this.#http = http;
    this.#jar = jar;
  }

  /** Подписка на события авторизации. */
  get on(): Emitter<AuthEvents>['on'] {
    return this.#emitter.on.bind(this.#emitter);
  }

  /** Подписка на одно срабатывание. */
  get once(): Emitter<AuthEvents>['once'] {
    return this.#emitter.once.bind(this.#emitter);
  }

  /**
   * Есть ли признак живой refresh-сессии.
   *
   * Сайт итд.com ставит рядом с refresh-токеном незакрытую cookie `is_auth` — по ней клиент
   * понимает, что обновление вообще имеет смысл, и не дёргает API у анонимов.
   * В браузере cookie ведёт сама среда, поэтому там ответ всегда `true`.
   */
  hasRefreshSession(): boolean {
    if (!this.#config.useCookieJar) return true;
    if (this.#jar.has(AUTH_FLAG_COOKIE)) return true;

    // Явно переданный refresh-токен — тоже основание пробовать.
    return Boolean(this.#session?.refreshToken);
  }

  /** Заголовки авторизации для очередного запроса. Пустой объект, если токена нет. */
  async getAuthHeaders(): Promise<Record<string, string>> {
    const token = await this.getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
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
      return (await auth.getToken()) ?? null;
    }

    if (typeof auth === 'object' && 'email' in auth) {
      return this.#signInWithCredentials(auth.email, auth.password);
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

  /** Ошибка «сессию продлить нечем» — одна и та же для `refresh()` и для реакции на 401. */
  #noRefreshSessionError(): ItdAuthError {
    return new ItdAuthError({
      status: 401,
      code: 'SESSION_EXPIRED',
      message: 'Не удалось обновить сессию: нет действующего refresh-токена',
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
    await this.#saveSession({ ...(this.#session ?? {}), accessToken, obtainedAt: Date.now() });
    this.#emitter.emit('tokens', { accessToken });
  }

  /** Текущая сессия целиком. Полезно, чтобы сохранить её самому. */
  async getSession(): Promise<ItdSession | null> {
    return this.#loadSession();
  }

  /** Заменяет сессию целиком. */
  async setSession(session: ItdSession): Promise<void> {
    this.#jar.deserialize(session.cookies);
    await this.#saveSession(session);
  }

  /** Забывает сессию и cookie. Сетевой запрос не выполняется. */
  async clear(): Promise<void> {
    this.#session = null;
    this.#jar.clear();
    await this.#config.storage.clear();
    this.#emitter.emit('signOut', undefined);
  }

  async #loadSession(): Promise<ItdSession | null> {
    if (this.#session !== undefined) return this.#session;

    const stored = (await this.#config.storage.get()) ?? null;

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

    return this.#session;
  }

  #sessionFromConfig(auth: AuthInput | undefined): ItdSession | null {
    if (!auth) return null;
    if (typeof auth === 'string') return { accessToken: auth, obtainedAt: Date.now() };

    if ('accessToken' in auth) {
      return {
        accessToken: auth.accessToken,
        refreshToken: auth.refreshToken,
        obtainedAt: Date.now(),
      };
    }

    return null;
  }

  async #saveSession(session: ItdSession): Promise<void> {
    const cookies = this.#config.useCookieJar ? this.#jar.serialize() : undefined;
    const next: ItdSession = { ...session, ...(cookies?.length ? { cookies } : {}) };

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

    if (!this.hasRefreshSession()) {
      // Нет признаков сессии — обновлять нечего. При наличии логина и пароля
      // пробуем войти заново.
      return this.#reloginOrNull();
    }

    try {
      const payload = await this.#http.request<unknown>({
        method: 'POST',
        path: AUTH_PATHS.refresh,
        // Обновление опирается на cookie, а не на устаревший Bearer.
        skipAuth: true,
        // Без этого 401 на самом обновлении вызвал бы новое обновление — и так по кругу.
        skipAuthRefresh: true,
        ...(this.#session?.refreshToken
          ? { body: { refreshToken: this.#session.refreshToken } }
          : {}),
      });

      const accessToken = readAccessToken(payload);
      if (!accessToken) return this.#reloginOrNull();

      await this.#saveSession({
        ...(this.#session ?? {}),
        accessToken,
        obtainedAt: Date.now(),
      });

      this.#emitter.emit('tokens', { accessToken });
      return accessToken;
    } catch (error) {
      if (error instanceof ItdApiError) {
        // Сессия недействительна — чистим её, иначе будем биться в стену на каждом запросе.
        this.#session = null;
        await this.#config.storage.clear();
        return this.#reloginOrNull();
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
      return await this.#signInWithCredentials(auth.email, auth.password);
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
  #signInWithCredentials(email: string, password: string): Promise<string> {
    if (this.#signingIn) return this.#signingIn;

    const promise = this.#performSignIn(email, password).finally(() => {
      this.#signingIn = null;
    });

    this.#signingIn = promise;
    return promise;
  }

  async #performSignIn(email: string, password: string): Promise<string> {
    const payload = await this.#http.request<unknown>({
      method: 'POST',
      path: AUTH_PATHS.signIn,
      body: { email, password },
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

    await this.#saveSession({ accessToken, obtainedAt: Date.now() });
    this.#emitter.emit('tokens', { accessToken });
    this.#emitter.emit('signIn', { accessToken });

    return accessToken;
  }
}
