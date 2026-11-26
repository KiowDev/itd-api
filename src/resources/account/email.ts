import type { RequestOptions } from '../../core/options.js';
import type { ContactActionResult, ContactChange } from '../../models/account-access.js';
import {
  ACCOUNT_EMAIL_ATTACH,
  ACCOUNT_EMAIL_RESEND_OTP,
  ACCOUNT_EMAIL_START_CHANGE,
} from '../../operations/account/email.js';
import {
  ACCOUNT_VERIFY_ATTACH,
  ACCOUNT_VERIFY_CHANGE,
} from '../../operations/account/verification.js';
import { BaseResource } from '../base.js';
import { requestAccount } from './request.js';
/** Привязка и смена почты текущего аккаунта. */
export class AccountEmailResource extends BaseResource {
  /**
   * Отправляет код на почту для привязки.
   *
   * @returns значение `flowToken` для {@link verifyAttach} или {@link resendOtp}
   *
   * @example
   * ```ts
   * const flowToken = await itd.account.email.attach(email);
   * await itd.account.email.verifyAttach({ email, flowToken, otp: await getOtp() });
   * ```
   */
  attach(email: string, options: RequestOptions = {}): Promise<string> {
    return requestAccount(this.http, ACCOUNT_EMAIL_ATTACH, '/email/attach', { email }, options);
  }

  /**
   * Отправляет код на новый адрес почты.
   *
   * @returns значение `flowToken` для {@link verifyChange} или {@link resendOtp}
   */
  startChange(email: string, options: RequestOptions = {}): Promise<string> {
    return requestAccount(
      this.http,
      ACCOUNT_EMAIL_START_CHANGE,
      '/email/change',
      { email },
      options,
    );
  }

  /**
   * Завершает привязку почты кодом.
   *
   * Передайте тот же адрес и `flowToken` из {@link attach}.
   */
  verifyAttach(
    input: { email: string; otp: string; flowToken: string },
    options: RequestOptions = {},
  ): Promise<ContactActionResult> {
    return requestAccount(this.http, ACCOUNT_VERIFY_ATTACH, '/verify-otp', input, options);
  }

  /**
   * Подтверждает код новой почты, запрошенный через {@link startChange}.
   *
   * @returns `changeToken` и способы завершить смену через `itd.account.changes`
   */
  verifyChange(
    input: { email: string; otp: string; flowToken: string },
    options: RequestOptions = {},
  ): Promise<ContactChange> {
    return requestAccount(this.http, ACCOUNT_VERIFY_CHANGE, '/verify-otp', input, options);
  }

  /** Повторно отправляет код на тот же адрес. Передайте `flowToken` из первого запроса. */
  resendOtp(
    input: { email: string; flowToken: string },
    options: RequestOptions = {},
  ): Promise<void> {
    return requestAccount(this.http, ACCOUNT_EMAIL_RESEND_OTP, '/email/resend-otp', input, options);
  }
}
