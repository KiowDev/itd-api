import type { RequestOptions } from '../../core/options.js';
import { voidOperation } from '../../operations/common.js';
import { BaseResource } from '../base.js';

const ACCOUNT_DEACTIVATE = voidOperation('account.deactivate');
const ACCOUNT_RESTORE = voidOperation('account.restore');

/** Деактивация и восстановление текущего аккаунта. */
export class AccountLifecycleResource extends BaseResource {
  /** Деактивирует аккаунт. Вернуть его можно через {@link restore}. */
  deactivate(options: RequestOptions = {}): Promise<void> {
    return this.voidOperation(ACCOUNT_DEACTIVATE, {
      path: '/api/users/me',
      ...options,
    });
  }

  /** Восстанавливает деактивированный аккаунт. */
  restore(options: RequestOptions = {}): Promise<void> {
    return this.voidOperation(ACCOUNT_RESTORE, {
      path: '/api/users/me/restore',
      ...options,
    });
  }
}
