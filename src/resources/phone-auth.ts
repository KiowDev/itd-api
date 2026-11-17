import type { CookieJar } from '../core/cookies.js';
import type { HttpClient } from '../core/execution/http.js';
import type { OperationContract } from '../core/operation.js';
import type { RequestOptions } from '../core/options.js';
import type { BuiltInOperationId } from '../domain/operations.js';
import {
  PHONE_CONSENT_FLOW,
  type PhoneConfig,
  type PhoneConsent,
  type PhoneDelivery,
  type PhoneLoginResult,
  type PhoneLoginStart,
  type PhoneReverseOptions,
  type PhoneReverseStatus,
  PhoneVerificationMethod,
} from '../models/phone-auth.js';
import type { CaptchaToken } from '../operations/auth.js';
import {
  AUTH_PHONE_CONFIG,
  AUTH_PHONE_CONSENT,
  AUTH_PHONE_PASSWORD,
  AUTH_PHONE_RESEND,
  AUTH_PHONE_RESET_PASSWORD,
  AUTH_PHONE_REVERSE_COMPLETE,
  AUTH_PHONE_REVERSE_OPTIONS,
  AUTH_PHONE_REVERSE_START,
  AUTH_PHONE_REVERSE_STATUS,
  AUTH_PHONE_START,
  AUTH_PHONE_VERIFY,
} from '../operations/phone-auth.js';
import type { AuthManager } from '../session/auth.js';
import { BaseResource } from './base.js';

/** Номер и секрет уже начатого телефонного потока. */
export interface PhoneFlowInput {
  /** Номер в международном формате с `+`. */
  phone: string;
  /** Секрет из start() либо обновлённый секрет из шага пароля. */
  flowToken: string;
}

/** Данные запуска телефонного входа после принятия документов пользователем. */
export interface PhoneLoginInput {
  /** Номер в международном формате с `+`. */
  phone: string;
  /** Получите через consent() и покажите пользователю документы перед отправкой. */
  consent: PhoneConsent;
  /** Готовый токен; без него используется источник captcha клиента. */
  captcha?: CaptchaToken | undefined;
  /** По умолчанию Direct: код входящего звонка или сообщения. */
  method?: PhoneVerificationMethod | undefined;
}

/** Телефонный вход и регистрация. Доступен как `itd.auth.phone`. */
export class PhoneAuthResource extends BaseResource {
  readonly #auth: AuthManager;

  constructor(http: HttpClient, deps: { auth: AuthManager }) {
    super(http);
    this.#auth = deps.auth;
  }

  /** Разрешённые регионы и примеры номеров. */
  config(options: RequestOptions = {}): Promise<PhoneConfig> {
    return this.#request(AUTH_PHONE_CONFIG, '/phone/config', undefined, options);
  }

  /**
   * Загружает контекст phone_entry вместе с текстом и редакциями документов.
   *
   * До start() покажите документы пользователю. Истёкший контекст и новые редакции
   * библиотека не заменяет автоматически.
   */
  consent(options: RequestOptions = {}): Promise<PhoneConsent> {
    return this.#request(
      AUTH_PHONE_CONSENT,
      `/consent?flow=${PHONE_CONSENT_FLOW}`,
      undefined,
      options,
    );
  }

  /**
   * Запрашивает подтверждение номера. Новый номер регистрируется тем же потоком.
   *
   * Токен капчи отправляется объектом { provider, token }.
   *
   * @returns секрет потока, канал доставки, длина кода и пауза повтора в секундах
   */
  async start(input: PhoneLoginInput, options: RequestOptions = {}): Promise<PhoneLoginStart> {
    const captcha = await this.#auth.captchaToken(input.captcha);
    return this.#request(
      AUTH_PHONE_START,
      '/phone/start',
      {
        phone: input.phone,
        captcha: captcha ? { provider: captcha.type, token: captcha.token } : undefined,
        legal: {
          protocolVersion: input.consent.protocolVersion,
          contextToken: input.consent.contextToken,
        },
      },
      {
        ...options,
        headers: {
          ...options.headers,
          ...(input.method === PhoneVerificationMethod.Reverse
            ? { 'X-ITD-Phone-Method': PhoneVerificationMethod.Reverse }
            : {}),
        },
      },
    );
  }

  /**
   * Подтверждает код без email и пароля.
   *
   * При accessToken сохраняет новую сессию; при step: 'password' возвращает секрет
   * для password(). Ответ смены контакта не считается успешным входом.
   */
  verify(
    input: PhoneFlowInput & { otp: string },
    options: RequestOptions = {},
  ): Promise<PhoneLoginResult> {
    return this.#complete(AUTH_PHONE_VERIFY, '/verify-otp', input, options);
  }

  /**
   * Запрашивает повторную доставку без изменения авторизации.
   *
   * Используйте новый channel/codeLength из результата: способ доставки может измениться.
   * retryIn — секунды до следующего запроса.
   */
  resend(input: PhoneFlowInput, options: RequestOptions = {}): Promise<PhoneDelivery> {
    return this.#request(AUTH_PHONE_RESEND, '/resend-otp', input, options);
  }

  /**
   * Завершает вход облачным паролем после step: 'password'.
   *
   * Передайте flowToken из этого шага. Полученный access token и cookies сохраняются
   * автоматически, если владелец сессии не сменился во время запроса.
   */
  password(
    input: PhoneFlowInput & { password: string },
    options: RequestOptions = {},
  ): Promise<string> {
    return this.#authenticate(AUTH_PHONE_PASSWORD, '/phone/password', input, options);
  }

  /** Устанавливает новый пароль в подтверждённом телефонном потоке и сохраняет сессию. */
  resetPassword(
    input: PhoneFlowInput & { newPassword: string },
    options: RequestOptions = {},
  ): Promise<string> {
    return this.#authenticate(AUTH_PHONE_RESET_PASSWORD, '/phone/reset-password', input, options);
  }

  /** Доступность исходящего звонка для текущего потока. */
  reverseOptions(
    input: PhoneFlowInput,
    options: RequestOptions = {},
  ): Promise<PhoneReverseOptions> {
    return this.#request(AUTH_PHONE_REVERSE_OPTIONS, '/phone/reverse/options', input, options);
  }

  /**
   * Подготавливает номер, на который пользователь должен позвонить.
   *
   * Может выделить новую попытку; не повторяется после сетевых ошибок и 5xx. Номер и срок
   * его действия возвращаются в phone и expiresIn.
   */
  reverseStart(input: PhoneFlowInput, options: RequestOptions = {}): Promise<PhoneReverseStatus> {
    return this.#request(AUTH_PHONE_REVERSE_START, '/phone/reverse/start', input, options);
  }

  /** Читает состояние звонка через POST, без завершения входа и смены сессии. */
  reverseStatus(input: PhoneFlowInput, options: RequestOptions = {}): Promise<PhoneReverseStatus> {
    return this.#request(AUTH_PHONE_REVERSE_STATUS, '/phone/reverse/status', input, options);
  }

  /** Завершает подтверждённый звонок; сервер может потребовать облачный пароль. */
  reverseComplete(input: PhoneFlowInput, options: RequestOptions = {}): Promise<PhoneLoginResult> {
    return this.#complete(AUTH_PHONE_REVERSE_COMPLETE, '/phone/reverse/complete', input, options);
  }

  /** Применяет cookies промежуточного шага либо атомарно сохраняет завершённый вход. */
  async #complete(
    operation: OperationContract<PhoneLoginResult, BuiltInOperationId>,
    path: string,
    input: PhoneFlowInput,
    options: RequestOptions,
  ): Promise<PhoneLoginResult> {
    const revision = this.#auth.revision();
    const cookies = this.#auth.createCookieFlow();
    const result = await this.#request(operation, path, input, options, cookies);
    if ('accessToken' in result) {
      await this.#auth.commitAuthFlow(result.accessToken, cookies, revision);
    } else {
      this.#auth.commitCookieFlow(cookies, revision);
    }
    return result;
  }

  /** Сохраняет результат пароля, не позволяя запоздалому ответу сменить нового владельца. */
  async #authenticate(
    operation: OperationContract<string, BuiltInOperationId>,
    path: string,
    input: PhoneFlowInput,
    options: RequestOptions,
  ): Promise<string> {
    const revision = this.#auth.revision();
    const cookies = this.#auth.createCookieFlow();
    const token = await this.#request(operation, path, input, options, cookies);
    await this.#auth.commitAuthFlow(token, cookies, revision);
    return token;
  }

  /**
   * Выполняет телефонный запрос без Bearer/refresh через общий pipeline.
   * X-ITD-Phone-Reverse объявляет поддержку обратного звонка и требуется для reverse-операций.
   */
  #request<T>(
    operation: OperationContract<T, BuiltInOperationId>,
    path: string,
    body: unknown,
    options: RequestOptions,
    cookies?: CookieJar,
  ): Promise<T> {
    return this.http.execute(operation, {
      ...options,
      path: `/api/v1/auth${path}`,
      body,
      ...(cookies ? { cookieJar: cookies } : {}),
      skipAuth: true,
      skipAuthRefresh: true,
      headers: {
        ...options.headers,
        ...(operation.method === 'POST' ? { 'X-ITD-Phone-Reverse': '1' } : {}),
        ...(path.startsWith('/phone/reverse/') ? { 'X-ITD-Reverse-Attempts': '1' } : {}),
      },
    });
  }
}
