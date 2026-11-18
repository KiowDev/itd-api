import type { HttpClient } from '../core/execution/http.js';
import type { RequestOptions } from '../core/options.js';
import type { AccountInfo } from '../models/account-access.js';
import { ACCOUNT_GET_INFO } from '../operations/account.js';
import type { AuthManager } from '../session/auth.js';
import { AccountChangesResource } from './account/changes.js';
import { AccountEmailResource } from './account/email.js';
import { AccountLifecycleResource } from './account/lifecycle.js';
import { AccountPasswordResource } from './account/password.js';
import { AccountPhoneResource } from './account/phone.js';
import { requestAccount } from './account/request.js';

/**
 * Настройки текущего аккаунта. Доступен как `itd.account`.
 *
 * Здесь можно менять номер, почту и облачный пароль, управлять отложенными
 * заявками, деактивировать и восстановить аккаунт.
 */
export class AccountResource extends AccountLifecycleResource {
  /** Привязка и смена номера. */
  readonly phone: AccountPhoneResource;
  /** Привязка и смена почты. */
  readonly email: AccountEmailResource;
  /** Настройка облачного пароля. */
  readonly password: AccountPasswordResource;
  /** Завершение смены номера или почты и отложенные заявки. */
  readonly changes: AccountChangesResource;

  constructor(http: HttpClient, auth: AuthManager) {
    super(http);
    this.phone = new AccountPhoneResource(http, auth);
    this.email = new AccountEmailResource(http);
    this.password = new AccountPasswordResource(http);
    this.changes = new AccountChangesResource(http);
  }

  /**
   * Получает сведения о доступе к текущему аккаунту.
   *
   * @returns привязанные номер и почту и признак наличия облачного пароля
   *
   * @example
   * ```ts
   * const { email, phone, hasPassword } = await itd.account.getInfo();
   * ```
   */
  getInfo(options: RequestOptions = {}): Promise<AccountInfo> {
    return requestAccount(this.http, ACCOUNT_GET_INFO, '/methods', undefined, options);
  }
}
