import { ItdStateError } from '../../core/errors.js';
import type { HttpClient } from '../../core/execution/http.js';
import type { RequestOptions } from '../../core/options.js';
import type { ContactActionResult, ContactChange } from '../../models/account-access.js';
import type {
  PhoneDelivery,
  PhoneFlowInput,
  PhoneFlowStart,
  PhoneReverseOptions,
  PhoneReverseStatus,
} from '../../models/phone-auth.js';
import {
  ACCOUNT_PHONE_ATTACH,
  ACCOUNT_PHONE_RESEND_OTP,
  ACCOUNT_PHONE_REVERSE_OPTIONS,
  ACCOUNT_PHONE_REVERSE_START,
  ACCOUNT_PHONE_REVERSE_STATUS,
  ACCOUNT_PHONE_START_CHANGE,
  ACCOUNT_PHONE_SYNC,
} from '../../operations/account/phone.js';
import {
  ACCOUNT_PHONE_REVERSE_ATTACH_COMPLETE,
  ACCOUNT_PHONE_REVERSE_CHANGE_COMPLETE,
  ACCOUNT_VERIFY_ATTACH,
  ACCOUNT_VERIFY_CHANGE,
} from '../../operations/account/verification.js';
import type { CaptchaToken } from '../../operations/auth.js';
import type { AuthManager } from '../../session/auth.js';
import { BaseResource } from '../base.js';
import { requestAccount } from './request.js';
/** Привязка и смена номера текущего аккаунта. */
export class AccountPhoneResource extends BaseResource {
  readonly #auth: AuthManager;

  constructor(http: HttpClient, auth: AuthManager) {
    super(http);
    this.#auth = auth;
  }

  /**
   * Запрашивает подтверждение номера для привязки.
   *
   * Передайте номер в международном формате с `+`. Если токен капчи не передан
   * в вызов, SDK использует настроенный источник капчи.
   *
   * @returns параметры доставки и `flowToken` для {@link verifyAttach}
   *
   * @example
   * ```ts
   * const { flowToken } = await itd.account.phone.attach({ phone });
   * await itd.account.phone.verifyAttach({ phone, flowToken, otp: await getOtp() });
   * ```
   */
  attach(
    input: { phone: string; captcha?: CaptchaToken },
    options: RequestOptions = {},
  ): Promise<PhoneFlowStart> {
    return this.#start(ACCOUNT_PHONE_ATTACH, '/phone/attach', input, options);
  }

  /**
   * Запрашивает подтверждение нового номера для смены.
   *
   * Формат номера и источник капчи такие же, как у {@link attach}.
   *
   * @returns параметры доставки и `flowToken` для {@link verifyChange}
   */
  startChange(
    input: { phone: string; captcha?: CaptchaToken },
    options: RequestOptions = {},
  ): Promise<PhoneFlowStart> {
    return this.#start(ACCOUNT_PHONE_START_CHANGE, '/phone/change', input, options);
  }

  /**
   * Завершает привязку номера кодом.
   *
   * Передайте номер и `flowToken` из {@link attach}.
   */
  verifyAttach(
    input: PhoneFlowInput & { otp: string },
    options: RequestOptions = {},
  ): Promise<ContactActionResult> {
    return requestAccount(this.http, ACCOUNT_VERIFY_ATTACH, '/verify-otp', input, options);
  }

  /**
   * Подтверждает код нового номера, запрошенный через {@link startChange}.
   *
   * @returns `changeToken` и способы завершить смену через `itd.account.changes`
   */
  verifyChange(
    input: PhoneFlowInput & { otp: string },
    options: RequestOptions = {},
  ): Promise<ContactChange> {
    return requestAccount(this.http, ACCOUNT_VERIFY_CHANGE, '/verify-otp', input, options);
  }

  /**
   * Повторно запрашивает код для того же номера. Передайте `flowToken` из первого запроса.
   *
   * @returns актуальные канал, длину кода и паузу до повтора в секундах
   */
  resendOtp(input: PhoneFlowInput, options: RequestOptions = {}): Promise<PhoneDelivery> {
    return requestAccount(this.http, ACCOUNT_PHONE_RESEND_OTP, '/resend-otp', input, options);
  }

  /** Синхронизирует привязанный номер с профилем. */
  sync(options: RequestOptions = {}): Promise<ContactActionResult> {
    return requestAccount(this.http, ACCOUNT_PHONE_SYNC, '/phone/sync', {}, options);
  }

  /** Возвращает доступность исходящего звонка для привязки или смены номера. */
  reverseOptions(
    input: PhoneFlowInput,
    options: RequestOptions = {},
  ): Promise<PhoneReverseOptions> {
    return requestAccount(
      this.http,
      ACCOUNT_PHONE_REVERSE_OPTIONS,
      '/phone/reverse/options',
      input,
      options,
    );
  }

  /**
   * Подготавливает номер, на который должен позвонить пользователь.
   *
   * @returns состояние попытки, номер для звонка и срок действия в секундах
   */
  reverseStart(input: PhoneFlowInput, options: RequestOptions = {}): Promise<PhoneReverseStatus> {
    return requestAccount(
      this.http,
      ACCOUNT_PHONE_REVERSE_START,
      '/phone/reverse/start',
      input,
      options,
    );
  }

  /**
   * Читает состояние исходящего звонка.
   *
   * После подтверждения вызовите {@link reverseAttachComplete} при привязке
   * или {@link reverseChangeComplete} при смене номера.
   */
  reverseStatus(input: PhoneFlowInput, options: RequestOptions = {}): Promise<PhoneReverseStatus> {
    return requestAccount(
      this.http,
      ACCOUNT_PHONE_REVERSE_STATUS,
      '/phone/reverse/status',
      input,
      options,
    );
  }

  /** Завершает привязку номера после исходящего звонка. */
  reverseAttachComplete(
    input: PhoneFlowInput,
    options: RequestOptions = {},
  ): Promise<ContactActionResult> {
    return requestAccount(
      this.http,
      ACCOUNT_PHONE_REVERSE_ATTACH_COMPLETE,
      '/phone/reverse/complete',
      input,
      options,
    );
  }

  /** Подтверждает новый номер звонком и возвращает варианты завершения смены. */
  reverseChangeComplete(
    input: PhoneFlowInput,
    options: RequestOptions = {},
  ): Promise<ContactChange> {
    return requestAccount(
      this.http,
      ACCOUNT_PHONE_REVERSE_CHANGE_COMPLETE,
      '/phone/reverse/complete',
      input,
      options,
    );
  }

  /** Запускает проверку номера, если за время получения капчи сессия не сменилась. */
  async #start(
    operation: typeof ACCOUNT_PHONE_ATTACH | typeof ACCOUNT_PHONE_START_CHANGE,
    path: string,
    { phone, captcha }: { phone: string; captcha?: CaptchaToken },
    options: RequestOptions,
  ): Promise<PhoneFlowStart> {
    const revision = this.#auth.revision();
    const proof = await this.#auth.captchaToken(captcha);
    if (this.#auth.revision() !== revision) {
      throw new ItdStateError(
        'Сессия сменилась во время получения капчи. Начните проверку номера заново.',
      );
    }
    return requestAccount(
      this.http,
      operation,
      path,
      { phone, captcha: proof ? { provider: proof.type, token: proof.token } : undefined },
      options,
    );
  }
}
