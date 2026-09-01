import type { AuthIdentity, AuthProvider, AuthProviderDeps } from '../core/auth-provider.js';
import type { ItdClock } from '../core/clock.js';
import {
  AUTH_FLAG_COOKIE,
  CookieJar,
  isSerializedCookieEntry,
  REFRESH_COOKIE,
  REFRESH_COOKIE_PATH,
} from '../core/cookies.js';
import { Emitter, reportListenerError } from '../core/emitter.js';
import { ItdAuthError, ItdConfigError, ItdStateError } from '../core/errors.js';
import type { HttpClient } from '../core/execution/http.js';
import type { Logger } from '../core/options.js';
import { createDeviceId } from '../core/runtime.js';
import { isRecord, requireOptionalBoolean } from '../core/validate.js';
import type { UserId } from '../models/common.js';
import {
  AUTH_CAPTCHA_PROVIDER,
  AUTH_REFRESH,
  AUTH_SIGN_IN,
  type CaptchaProvider,
  type CaptchaToken,
  SignInStatus,
} from '../operations/auth.js';
import {
  type CaptchaBody,
  captchaBody,
  readCaptchaProvider,
  resolveCaptchaSolver,
  solveCaptchaBody,
  validateCaptchaToken,
} from './captcha.js';
import { readTokenMetadata, type TokenMetadata } from './jwt.js';
import type { AuthInput, CaptchaSolver, CredentialsAuth, SessionOptions } from './options.js';
import { copySession, type ItdSession, MemoryTokenStorage, type TokenStorage } from './storage.js';

/** Запас до истечения токена на очередь и выполнение запроса. */
const ACCESS_TOKEN_REFRESH_LEEWAY_MS = 30_000;

/**
 * Настройки сессии после подстановки умолчаний и проверок.
 *
 * Часть полей заимствована у {@link ResolvedRuntimeConfig}: сессия ходит на тот же хост,
 * теми же часами и с тем же логгером, но остальные настройки исполнения ей не нужны.
 */
export interface SessionConfig {
  baseUrl: string;
  clock: ItdClock;
  useCookieJar: boolean;
  logger: Logger | undefined;
  auth: AuthInput | undefined;
  captcha: CaptchaSolver | undefined;
  storage: TokenStorage;
  deviceId: string | undefined;
  autoRefresh: boolean;
  reloginOnRefreshFailure: boolean;
}

/**
 * Проверяет форму `auth` и сообщает о типичных ошибках понятным текстом.
 *
 * Молчаливое игнорирование неверной формы приводит к загадочным `401`, поэтому
 * ошибка возникает сразу при создании клиента.
 */
function validateAuth(auth: AuthInput | undefined): AuthInput | undefined {
  if (auth === undefined) return undefined;

  if (typeof auth === 'string') {
    if (auth.trim() === '') {
      throw new ItdConfigError('auth: передана пустая строка вместо accessToken');
    }
    return auth;
  }

  if (typeof auth !== 'object' || auth === null) {
    throw new ItdConfigError(
      `auth должен быть строкой с токеном или объектом, получено: ${typeof auth}`,
    );
  }

  const modes = [
    'getToken' in auth,
    'accessToken' in auth || 'refreshToken' in auth,
    'email' in auth || 'password' in auth,
  ].filter(Boolean).length;
  if (modes > 1) {
    throw new ItdConfigError(
      'auth должен описывать ровно один способ авторизации: getToken, accessToken или email/password',
    );
  }

  if ('getToken' in auth) {
    if (typeof auth.getToken !== 'function') {
      throw new ItdConfigError('auth.getToken должен быть функцией');
    }
    return { ...auth };
  }

  if ('accessToken' in auth) {
    if (typeof auth.accessToken !== 'string' || auth.accessToken.trim() === '') {
      throw new ItdConfigError('auth.accessToken должен быть непустой строкой');
    }
    if (
      auth.refreshToken !== undefined &&
      (typeof auth.refreshToken !== 'string' || auth.refreshToken.trim() === '')
    ) {
      throw new ItdConfigError('auth.refreshToken должен быть непустой строкой');
    }
    return { ...auth };
  }

  if ('email' in auth || 'password' in auth) {
    const { email, password, captcha } = auth as {
      email?: unknown;
      password?: unknown;
      captcha?: unknown;
    };
    if (typeof email !== 'string' || email.trim() === '') {
      throw new ItdConfigError('auth.email должен быть непустой строкой');
    }
    if (typeof password !== 'string' || password === '') {
      throw new ItdConfigError('auth.password должен быть непустой строкой');
    }

    validateCaptchaToken(captcha, 'auth.captcha');

    return { ...auth };
  }

  throw new ItdConfigError(
    'auth не распознан. Ожидается строка с accessToken либо объект ' +
      '{ accessToken }, { email, password } или { getToken }',
  );
}

function resolveStorage(storage: TokenStorage | undefined): TokenStorage {
  if (storage === undefined) return new MemoryTokenStorage();
  if (!isRecord(storage)) throw new ItdConfigError('storage должен быть объектом TokenStorage');

  for (const method of ['get', 'set', 'clear'] as const) {
    if (typeof storage[method] !== 'function') {
      throw new ItdConfigError(`storage.${method} должен быть функцией`);
    }
  }
  return storage;
}

/**
 * Приводит настройки сессии к полному виду.
 *
 * @param runtime уже разрешённая конфигурация исполнения — из неё берутся общие поля
 * @throws {ItdConfigError} при некорректных значениях
 */
export function resolveSessionConfig(
  options: SessionOptions,
  runtime: Pick<SessionConfig, 'baseUrl' | 'clock' | 'useCookieJar' | 'logger'>,
): SessionConfig {
  if (!isRecord(options)) throw new ItdConfigError('опции клиента должны быть объектом');

  requireOptionalBoolean(options.autoRefresh, 'autoRefresh');
  requireOptionalBoolean(options.reloginOnRefreshFailure, 'reloginOnRefreshFailure');

  if (
    options.deviceId !== undefined &&
    (typeof options.deviceId !== 'string' || options.deviceId.trim() === '')
  ) {
    throw new ItdConfigError('deviceId должен быть непустой строкой');
  }

  return {
    ...runtime,
    auth: validateAuth(options.auth),
    captcha: resolveCaptchaSolver(options.captcha),
    storage: resolveStorage(options.storage),
    deviceId: options.deviceId,
    autoRefresh: options.autoRefresh ?? true,
    reloginOnRefreshFailure: options.reloginOnRefreshFailure ?? true,
  };
}

/**
 * Собирает менеджер сессии итд.com как реализацию {@link AuthProvider}.
 *
 * Единственная точка, где конвейер запросов встречается с полноценной авторизацией.
 * Ядро её не вызывает — фабрику передаёт фасад клиента, иначе ссылка на сессию оказалась бы
 * достижимой из любой сборки, включая анонимную.
 */
export function createItdAuth(options: SessionOptions, deps: AuthProviderDeps): AuthManager {
  return new AuthManager(resolveSessionConfig(options, deps.config), deps.http, deps.cookies, {
    onAccountChange: deps.onAccountChange,
  });
}

/** Пути эндпоинтов авторизации. */
export const AUTH_PATHS = {
  captchaProvider: '/api/v1/auth/captcha/provider',
  captchaPage: '/api/v1/auth/captcha/page',
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
  qrStart: '/api/v1/auth/qr/start',
  qrClaim: '/api/v1/auth/qr/claim',
  qrStream: '/api/v1/auth/qr/stream',
  qrScan: '/api/v1/auth/qr/scan',
  qrApprove: '/api/v1/auth/qr/approve',
  qrReject: '/api/v1/auth/qr/reject',
} as const;

/**
 * Публичный ключ Cloudflare Turnstile платформы итд.com.
 *
 * Нужен, чтобы отрисовать виджет капчи и получить токен для `signIn`, `signUp`
 * и `forgotPassword`.
 *
 * Ключ привязан к домену: на чужом origin Cloudflare отказывает виджету с кодом `110200`.
 * Поэтому отрисовать его может только код, выполняемый на самом итд.com. Остальным
 * подходит `@itd-api/captcha`, готовый токен из другого источника или вовсе вход
 * без капчи — по сохранённой сессии либо по токенам, взятым в браузере.
 *
 * @example
 * ```ts
 * turnstile.render('#captcha', {
 *   sitekey: TURNSTILE_SITE_KEY,
 *   callback: (token) =>
 *     itd.auth.signIn({ email, password, captcha: { type: CaptchaType.Cloudflare, token } }),
 * });
 * ```
 */
export const TURNSTILE_SITE_KEY = '0x4AAAAAACHhxczw6fJGwPBg';

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

/** Убирает поле, которое сохраняли промежуточные версии с поддержкой `getUserId()`. */
function withoutLegacyUserId(session: ItdSession): ItdSession {
  const clean = copySession(session);
  delete (clean as ItdSession & { userId?: unknown }).userId;
  return clean;
}

function normalizeSessionValue(
  value: unknown,
  source: string,
  mode: 'strict' | 'stored' = 'strict',
  logger?: Logger,
): ItdSession | null {
  const tolerant = mode === 'stored';
  if (!isRecord(value)) {
    if (tolerant) {
      logger?.warn(`${source} вернула не объект сессии; сохранённая запись пропущена`);
      return null;
    }
    throw new ItdConfigError(`${source} должна быть объектом сессии`);
  }
  const record = value as Record<string, unknown>;
  // Неизвестные поля могут принадлежать более новой версии библиотеки. Сохраняем их,
  // а известные поля проверяем и исправляем ниже.
  const normalized: Record<string, unknown> = { ...record };
  delete normalized.userId;

  const normalizeString = (field: 'accessToken' | 'refreshToken' | 'deviceId'): void => {
    const item = record[field];
    if (item === undefined) {
      delete normalized[field];
      return;
    }
    if (item !== undefined && (typeof item !== 'string' || item.trim() === '')) {
      if (tolerant) {
        logger?.warn(`${source}.${field} повреждена; поле сохранённой сессии пропущено`);
        delete normalized[field];
        return;
      }
      throw new ItdConfigError(`${source}.${field} должна быть непустой строкой`);
    }
    normalized[field] = item;
  };

  normalizeString('accessToken');
  normalizeString('refreshToken');
  normalizeString('deviceId');

  if (record.obtainedAt === undefined) {
    delete normalized.obtainedAt;
  } else if (typeof record.obtainedAt !== 'number' || !Number.isFinite(record.obtainedAt)) {
    if (!tolerant) {
      throw new ItdConfigError(`${source}.obtainedAt должна быть конечным числом`);
    } else {
      logger?.warn(`${source}.obtainedAt повреждена; поле сохранённой сессии пропущено`);
      delete normalized.obtainedAt;
    }
  }

  if (record.cookies === undefined) {
    delete normalized.cookies;
  } else {
    if (!Array.isArray(record.cookies)) {
      if (tolerant) {
        logger?.warn(`${source}.cookies повреждена; поле сохранённой сессии пропущено`);
        delete normalized.cookies;
      } else {
        throw new ItdConfigError(`${source}.cookies должна быть массивом`);
      }
    } else {
      // Одна повреждённая или устаревшая запись не должна блокировать рабочие токены.
      // CookieJar.deserialize придерживается той же мягкой политики.
      const valid = record.cookies.filter(
        (cookie: unknown): cookie is string =>
          typeof cookie === 'string' && isSerializedCookieEntry(cookie),
      );
      if (valid.length > 0) normalized.cookies = valid;
      else delete normalized.cookies;
    }
  }

  return normalized as ItdSession;
}

function normalizeSession(value: unknown, source: string): ItdSession {
  const normalized = normalizeSessionValue(value, source);
  if (!normalized) throw new ItdConfigError(`${source} должна быть объектом сессии`);
  return normalized;
}

let authScopeSequence = 0;

function nextAuthScope(): string {
  authScopeSequence += 1;
  return String(authScopeSequence);
}

interface AuthManagerHooks {
  /** Вызывается синхронно перед заменой владельца авторизации. */
  onAccountChange?: (() => void) | undefined;
}

interface RefreshExpectation {
  epoch: number;
  accessToken?: string | undefined;
}

interface InFlightRefresh {
  epoch: number;
  promise: Promise<string | null>;
}

/**
 * Хранит сессию и продлевает её.
 *
 * Главное здесь — **дедупликация обновления**. Когда десять параллельных запросов
 * одновременно получают `401`, обновление должно произойти один раз, а остальные обязаны
 * дождаться его результата. Иначе сервер увидит десять параллельных `refresh`, и все,
 * кроме первого, скорее всего получат отказ по уже использованному токену.
 */
export class AuthManager implements AuthProvider {
  readonly #config: SessionConfig;
  readonly #http: HttpClient;
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
  /** Текущее обновление: к нему присоединяются запросы той же ревизии. */
  #refreshing: InFlightRefresh | null = null;
  /** Общий промис входа по логину и паролю. */
  #signingIn: Promise<string | null> | null = null;
  /** Fallback-область для изоляции состояния плагинов, когда JWT-идентичность недоступна. */
  #authScope = nextAuthScope();
  /** Последний токен внешнего источника; `undefined` означает, что источник ещё не читался. */
  #externalToken: string | null | undefined;
  /** Идентификаторы последнего токена внешнего источника для синхронных потребителей. */
  #externalIdentity: AuthIdentity | undefined;
  #tokenMetadata: { accessToken: string; value: TokenMetadata } | undefined;
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
   * `setSession`, `setAccessToken`, вход. Refresh сверяет снимок до и после сетевого запроса.
   */
  #authEpoch = 0;
  #externalReadGeneration = 0;
  /** Разовый токен из `auth.captcha` тратится ровно на один запрос. */
  #configCaptchaSpent = false;
  #disposed = false;
  #persistence: Promise<void> = Promise.resolve();

  constructor(
    config: SessionConfig,
    http: HttpClient,
    jar: CookieJar,
    hooks: AuthManagerHooks = {},
  ) {
    this.#config = config;
    this.#http = http;
    this.#jar = jar;
    this.#hooks = hooks;
    this.#emitter = new Emitter<AuthEvents>((error) =>
      reportListenerError(config.logger, 'авторизации', error),
    );
  }

  /** Подписка на события авторизации. */
  get on(): Emitter<AuthEvents>['on'] {
    return ((...args: Parameters<Emitter<AuthEvents>['on']>) => {
      this.#assertActive();
      return this.#emitter.on(...args);
    }) as Emitter<AuthEvents>['on'];
  }

  /** Подписка на одно срабатывание. */
  get once(): Emitter<AuthEvents>['once'] {
    return ((...args: Parameters<Emitter<AuthEvents>['once']>) => {
      this.#assertActive();
      return this.#emitter.once(...args);
    }) as Emitter<AuthEvents>['once'];
  }

  /** Снимает служебные подписки при окончательном освобождении владельца. @internal */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#externalReadGeneration += 1;
    this.#invalidateInFlight();
    this.#tokenMetadata = undefined;
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
    this.#assertActive();
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
    this.#externalReadGeneration += 1;
  }

  /** Ревизия владельца сессии для условного commit внешнего auth-flow. @internal */
  revision(): number {
    this.#assertActive();
    return this.#authEpoch;
  }

  /** Создаёт изолированный jar для сетевого auth-flow. @internal */
  createCookieFlow(inherit = true): CookieJar {
    this.#assertActive();
    return inherit ? this.#jar.clone() : new CookieJar();
  }

  /** Применяет cookies только если владелец сессии не сменился. @internal */
  commitCookieFlow(cookies: CookieJar, expectedRevision: number): boolean {
    this.#assertActive();
    if (this.#authEpoch !== expectedRevision) return false;
    this.#jar.replaceWith(cookies);
    return true;
  }

  #assertActive(): void {
    if (this.#disposed) throw new ItdStateError('Менеджер авторизации уже освобождён');
  }

  #currentAccessToken(): string | null {
    return this.#session?.accessToken ?? null;
  }

  #identityForToken(accessToken: string | undefined): AuthIdentity {
    const token = this.#metadataForToken(accessToken);
    return {
      ...(token.subject ? { userId: token.subject as UserId } : {}),
      ...(token.sessionId ? { sessionId: token.sessionId } : {}),
    };
  }

  #metadataForToken(accessToken: string | undefined): TokenMetadata {
    if (!accessToken) {
      this.#tokenMetadata = undefined;
      return {};
    }
    if (this.#tokenMetadata?.accessToken === accessToken) return this.#tokenMetadata.value;

    const value = readTokenMetadata(accessToken);
    this.#tokenMetadata = { accessToken, value };
    return value;
  }

  async #readExternalToken(
    getToken: () => string | null | Promise<string | null>,
  ): Promise<string | null> {
    this.#assertActive();
    const generation = ++this.#externalReadGeneration;
    const token = (await getToken()) ?? null;
    this.#assertActive();
    if (generation !== this.#externalReadGeneration) return token;
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

  /** Обновляет резервный идентификатор и закрывает события при смене аккаунта. */
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
    this.#assertActive();
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

  /** Готовит внутреннюю сессию до retry исходного запроса. */
  async preflight(allowRefresh: boolean): Promise<void> {
    this.#assertActive();
    const session = await this.#loadSession();
    let accessToken = session?.accessToken;

    if (!accessToken) {
      const auth = this.#config.auth;
      if (typeof auth === 'object' && auth !== null && 'email' in auth) {
        accessToken = (await this.#signInWithCredentials(auth)) ?? undefined;
      }
    }

    if (!accessToken || !allowRefresh || !this.#config.autoRefresh) return;

    const expiresAt = this.#metadataForToken(accessToken).expiresAt;
    if (
      expiresAt === undefined ||
      expiresAt > this.#config.clock.now() + ACCESS_TOKEN_REFRESH_LEEWAY_MS ||
      !this.#hasRefreshSession()
    ) {
      return;
    }

    try {
      await this.#refreshDeduplicated({ epoch: this.#authEpoch, accessToken });
    } catch (error) {
      this.#emitter.emit('authError', { error });
      throw error;
    }
  }

  /** Перед каждой попыткой перечитывает внешний источник токена. */
  async prepare(): Promise<void> {
    this.#assertActive();
    const session = await this.#loadSession();
    if (session?.accessToken) return;

    const auth = this.#config.auth;
    if (typeof auth === 'object' && auth !== null && 'getToken' in auth) {
      await this.#readExternalToken(() => auth.getToken());
    }
  }

  /**
   * Заголовки уже подготовленной авторизации без чтения storage или вызова внешнего источника.
   *
   * Используются после ожидания транспортной очереди: к этому моменту {@link prepare} уже
   * был вызван снаружи неё, но token мог успеть смениться из-за refresh или `setSession()`.
   */
  currentHeaders(): Record<string, string> {
    const session =
      this.#session === undefined ? this.#sessionFromConfig(this.#config.auth) : this.#session;
    const token = session?.accessToken ?? this.#externalToken ?? null;
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  /**
   * Реакция конвейера на `401`. Стадия `auth_recovery`.
   *
   * При выключенном `autoRefresh` ничего не делает: вызывающий код обновляет сессию сам
   * через `itd.auth.refresh()`, а библиотека просто пробрасывает {@link ItdAuthError}.
   */
  recover(): Promise<boolean> {
    this.#assertActive();
    return this.#config.autoRefresh ? this.onUnauthorized() : Promise.resolve(false);
  }

  /**
   * Идентификатор устройства для заголовка `X-Device-Id`.
   *
   * Заводится один раз и сохраняется в сессии, чтобы пережить перезапуск процесса:
   * сервер связывает с ним запись в списке сессий, и плавающее значение плодило бы
   * по новой сессии на каждый старт.
   */
  deviceId(): Promise<string> {
    this.#assertActive();
    if (this.#deviceId) return Promise.resolve(this.#deviceId);

    // Дедупликация: параллельные вызовы на холодном клиенте получают один `X-Device-Id`.
    this.#deviceIdLoading ??= this.#resolveDeviceId().finally(() => {
      this.#deviceIdLoading = null;
    });

    return this.#deviceIdLoading;
  }

  async #resolveDeviceId(): Promise<string> {
    const revision = this.#authEpoch;
    const session = await this.#loadSession();
    this.#assertActive();
    const deviceId = this.#config.deviceId ?? session?.deviceId ?? createDeviceId();

    this.#deviceId = deviceId;
    if (this.#authEpoch !== revision) return deviceId;

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
  async token(): Promise<string | null> {
    this.#assertActive();
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
    this.#assertActive();
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
    this.#assertActive();
    const token = await this.#refreshDeduplicated();
    if (token === null) throw this.#noRefreshSessionError();
    return token;
  }

  /** Сохраняет токен, полученный извне, — например после подтверждения OTP. */
  async setAccessToken(
    accessToken: string,
    expectedRevision = this.#authEpoch,
    cookies?: CookieJar,
  ): Promise<boolean> {
    return this.#storeAccessToken(accessToken, expectedRevision, cookies, false);
  }

  /** Атомарно принимает токен и cookie завершённого входа как новую сессию. @internal */
  async commitAuthFlow(
    accessToken: string,
    cookies: CookieJar,
    expectedRevision = this.#authEpoch,
  ): Promise<boolean> {
    return this.#storeAccessToken(accessToken, expectedRevision, cookies, true);
  }

  async #storeAccessToken(
    accessToken: string,
    expectedRevision: number,
    cookies: CookieJar | undefined,
    replaceSession: boolean,
  ): Promise<boolean> {
    this.#assertActive();
    if (typeof accessToken !== 'string' || accessToken.trim() === '') {
      throw new ItdConfigError('accessToken должен быть непустой строкой');
    }
    await this.#loadSession();
    this.#assertActive();
    if (this.#authEpoch !== expectedRevision) return false;
    if (cookies) this.#jar.replaceWith(cookies);
    this.#invalidateInFlight();
    this.#transitionAuth(accessToken);
    const saved = this.#saveSession({
      ...(replaceSession ? {} : (this.#session ?? {})),
      accessToken,
      obtainedAt: this.#config.clock.now(),
    });
    this.#emitter.emit('tokens', { accessToken });
    await saved;
    return true;
  }

  /** Текущая сессия целиком. Полезно, чтобы сохранить её самому. */
  async getSession(): Promise<ItdSession | null> {
    this.#assertActive();
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
    this.#assertActive();
    const session = await this.#loadSession();
    return session?.accessToken ? this.#identityForToken(session.accessToken).userId : undefined;
  }

  /** Заменяет сессию и связанные с ней cookie целиком. */
  async setSession(session: ItdSession): Promise<void> {
    this.#assertActive();
    const normalized = normalizeSession(session, 'session');
    await this.#loadSession();
    this.#assertActive();
    this.#invalidateInFlight();
    this.#transitionAuth(normalized.accessToken);
    this.#jar.clear();
    this.#jar.deserialize(normalized.cookies);

    if (normalized.deviceId) this.#deviceId = normalized.deviceId;

    // Refresh-cookie добавляется до сериализации сессии.
    this.#session = normalized;
    this.#seedRefreshCookie();

    await this.#saveSession(normalized);
  }

  /**
   * Забывает сессию и cookie. Сетевой запрос не выполняется.
   *
   * Идентификатор устройства выход переживает: иначе каждая пара «выход — вход» плодила бы
   * новую запись в списке сессий.
   */
  async clear(): Promise<void> {
    this.#assertActive();
    await this.#loadSession();
    this.#assertActive();
    this.#invalidateInFlight();
    this.#transitionAuth(undefined);
    this.#jar.clear();
    const retained = this.#deviceId ? { deviceId: this.#deviceId } : null;
    this.#session = retained;
    this.#emitter.emit('signOut', undefined);
    await this.#enqueuePersistence(async () => {
      await this.#config.storage.clear();
      if (retained) await this.#config.storage.set(copySession(retained));
    });
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
    this.#assertActive();
    const stored =
      loaded === null
        ? null
        : normalizeSessionValue(loaded, 'storage.get()', 'stored', this.#config.logger);

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
    if (this.#jar.has(REFRESH_COOKIE, this.#config.baseUrl + REFRESH_COOKIE_PATH)) return;

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
    const { cookies: _staleCookies, ...withoutCookies } = copySession(session);

    const next = withoutLegacyUserId({
      ...withoutCookies,
      ...(cookies?.length ? { cookies } : {}),
      ...(deviceId ? { deviceId } : {}),
    });

    this.#session = next;
    await this.#enqueuePersistence(() => this.#config.storage.set(copySession(next)));
  }

  #enqueuePersistence(operation: () => void | Promise<void>): Promise<void> {
    const pending = this.#persistence.then(operation, operation);
    this.#persistence = pending.catch(() => {});
    return pending;
  }

  /** Дедуплицирует refresh одной ревизии; следующая ждёт завершения предыдущей. */
  #refreshDeduplicated(
    expectation: RefreshExpectation = { epoch: this.#authEpoch },
  ): Promise<string | null> {
    const current = this.#refreshing;
    if (current) {
      if (current.epoch === expectation.epoch) return current.promise;
      return current.promise.then(
        () => this.#refreshDeduplicated(expectation),
        () => this.#refreshDeduplicated(expectation),
      );
    }

    const promise = this.#performRefresh(expectation).finally(() => {
      if (this.#refreshing?.promise === promise) this.#refreshing = null;
    });

    this.#refreshing = { epoch: expectation.epoch, promise };
    return promise;
  }

  #matchesRefreshExpectation(expectation: RefreshExpectation): boolean {
    return (
      this.#authEpoch === expectation.epoch &&
      (expectation.accessToken === undefined ||
        this.#session?.accessToken === expectation.accessToken)
    );
  }

  async #performRefresh(expectation: RefreshExpectation): Promise<string | null> {
    this.#assertActive();
    await this.#loadSession();
    if (!this.#matchesRefreshExpectation(expectation)) return this.#currentAccessToken();

    if (!this.#hasRefreshSession()) {
      // Нет признаков сессии — обновлять нечего. При наличии логина и пароля
      // пробуем войти заново.
      return this.#reloginOrNull();
    }

    const flowCookies = this.#jar.clone();

    try {
      // Служебный запрос идёт через общий pipeline. Слой авторизации он пропускает, чтобы
      // не отправлять устаревший Bearer и не запускать рекурсивный refresh. Очередь безопасна:
      // исходная неудачная транспортная попытка освободила свой слот до вызова этого метода.
      const accessToken = await this.#http.execute(AUTH_REFRESH, {
        path: AUTH_PATHS.refresh,
        skipAuth: true,
        skipAuthRefresh: true,
        cookieJar: flowCookies,
        // Тела нет намеренно: сервер читает refresh-токен только из cookie — см.
        // #seedRefreshCookie. По той же причине не нужен и устаревший Bearer.
      });

      if (!this.#matchesRefreshExpectation(expectation)) {
        // Пока шёл refresh, владельца сменили (signOut / setSession / вход): его результат
        // устарел. Не воскрешаем сохранённую сессию, отдаём актуальный токен как есть.
        return this.#session?.accessToken ?? null;
      }

      this.#jar.replaceWith(flowCookies);

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
      const saved = this.#saveSession({
        ...(this.#session ?? {}),
        accessToken,
        ...(rotated ? { refreshToken: rotated } : {}),
        obtainedAt: this.#config.clock.now(),
      });

      this.#emitter.emit('tokens', { accessToken });
      await saved;
      if (this.#authEpoch !== expectation.epoch) return this.#currentAccessToken();
      return accessToken;
    } catch (error) {
      if (this.#authEpoch !== expectation.epoch) return this.#currentAccessToken();
      if (error instanceof ItdAuthError) {
        // Сессия недействительна — чистим её, иначе будем биться в стену на каждом запросе.
        this.#invalidateInFlight();
        const clearedRevision = this.#authEpoch;
        this.#transitionAuth(undefined);
        this.#session = null;
        this.#jar.clear();
        await this.#enqueuePersistence(() => this.#config.storage.clear());
        if (this.#authEpoch !== clearedRevision) return this.#currentAccessToken();

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
    } catch (error) {
      this.#config.logger?.warn('Автоматический повторный вход не удался', error);
      return null;
    }
  }

  /**
   * Вход по логину и паролю.
   *
   * Параллельные вызовы объединяются: одновременный старт нескольких запросов не должен
   * приводить к нескольким попыткам входа и блокировке аккаунта.
   */
  #signInWithCredentials(credentials: CredentialsAuth): Promise<string | null> {
    if (this.#signingIn) return this.#signingIn;

    const revision = this.#authEpoch;
    const promise = this.#performSignIn(credentials, revision).finally(() => {
      this.#signingIn = null;
    });

    this.#signingIn = promise;
    return promise;
  }

  /**
   * Готовит фрагмент тела с токеном капчи для запроса, который её требует.
   *
   * Источники в порядке убывания приоритета: токен, переданный в сам вызов; разовый токен
   * из `auth.captcha`; опция `captcha`. Когда ни одного нет, фрагмент пустой: нужна ли
   * капча этому запросу, решает сервер.
   *
   * @param explicit готовый токен, переданный в вызов
   * @throws {ItdConfigError} если токен неполный или источник его не вернул
   */
  async captchaBody(explicit?: CaptchaToken | undefined): Promise<CaptchaBody> {
    if (explicit) return captchaBody(explicit);

    const configured = this.#takeConfiguredCaptcha();
    if (configured) return captchaBody(configured);

    const solver = this.#config.captcha;
    if (solver) return solveCaptchaBody(solver, () => this.#resolveCaptchaProvider());

    this.#config.logger?.debug(
      'Запрос уходит без токена капчи: не передан аргумент captcha и не задана опция captcha',
    );
    return {};
  }

  /** Отдаёт разовый токен из `auth.captcha`, помечая его потраченным. */
  #takeConfiguredCaptcha(): CaptchaToken | undefined {
    if (this.#configCaptchaSpent) return undefined;

    const auth = this.#config.auth;
    const captcha = isRecord(auth) ? (auth as CredentialsAuth).captcha : undefined;
    if (!captcha) return undefined;

    this.#configCaptchaSpent = true;
    return captcha;
  }

  /** Спрашивает у сервера активного провайдера и поле, в котором он ждёт токен. */
  async #resolveCaptchaProvider(): Promise<CaptchaProvider> {
    const provider: unknown = await this.#http.execute(AUTH_CAPTCHA_PROVIDER, {
      path: AUTH_PATHS.captchaProvider,
      skipAuth: true,
      skipAuthRefresh: true,
    });

    return readCaptchaProvider(provider);
  }

  async #performSignIn(credentials: CredentialsAuth, revision: number): Promise<string | null> {
    const captcha = await this.captchaBody();
    const flowCookies = new CookieJar();

    // Через общий pipeline: плагины, повторы и очередь сохраняются, а слой авторизации
    // пропускается, потому что токена ещё нет.
    const result = await this.#http.execute(AUTH_SIGN_IN, {
      path: AUTH_PATHS.signIn,
      body: { email: credentials.email, password: credentials.password, ...captcha },
      skipAuth: true,
      skipAuthRefresh: true,
      cookieJar: flowCookies,
    });

    if (result.status !== SignInStatus.Authenticated) {
      // Сервер запросил подтверждение по коду — автоматически это не пройти.
      throw new ItdConfigError(
        'Вход по email и паролю требует подтверждения кодом из письма. Автоматический вход ' +
          'невозможен: воспользуйтесь itd.auth.signInWithOtp() и передайте полученный ' +
          'accessToken в конфигурацию клиента.',
      );
    }
    const accessToken = result.accessToken;
    this.#assertActive();
    if (this.#authEpoch !== revision) return this.#session?.accessToken ?? null;
    this.#jar.replaceWith(flowCookies);

    // Прежний refresh-токен и cookie намеренно не переносятся: вход выдал новую сессию,
    // и держаться за старую было бы ошибкой. Идентификатор устройства добавит #saveSession.
    this.#invalidateInFlight();
    this.#transitionAuth(accessToken);
    const saved = this.#saveSession({ accessToken, obtainedAt: this.#config.clock.now() });
    this.#emitter.emit('tokens', { accessToken });
    this.#emitter.emit('signIn', { accessToken });
    await saved;

    return accessToken;
  }
}
