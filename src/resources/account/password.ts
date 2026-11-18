import type { RequestOptions } from '../../core/options.js';
import { ACCOUNT_PASSWORD_CHANGE, ACCOUNT_PASSWORD_SET } from '../../operations/account.js';
import { BaseResource } from '../base.js';
import { requestAccount } from './request.js';

/** Облачный пароль текущего аккаунта. */
export class AccountPasswordResource extends BaseResource {
  /**
   * Создаёт облачный пароль для аккаунта без пароля.
   *
   * Наличие пароля можно проверить через `itd.account.getInfo()`.
   */
  set(password: string, options: RequestOptions = {}): Promise<void> {
    return requestAccount(this.http, ACCOUNT_PASSWORD_SET, '/set-password', { password }, options);
  }

  /**
   * Меняет облачный пароль в действующей сессии.
   *
   * При неверном текущем пароле сервер возвращает `ACCOUNT_CURRENT_PASSWORD_INCORRECT`.
   *
   * @example
   * ```ts
   * await itd.account.password.change({ currentPassword, newPassword });
   * ```
   */
  change(
    { currentPassword, newPassword }: { currentPassword: string; newPassword: string },
    options: RequestOptions = {},
  ): Promise<void> {
    return this.voidOperation(ACCOUNT_PASSWORD_CHANGE, {
      path: '/api/v1/auth/change-password',
      body: { currentPassword, newPassword },
      ...options,
    });
  }
}
