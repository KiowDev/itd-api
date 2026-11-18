import type { RequestOptions } from '../../core/options.js';
import type {
  ContactChangeSchedule,
  ContactProofDelivery,
  ContactProofMethod,
  PendingContactChange,
} from '../../models/account-access.js';
import {
  ACCOUNT_CHANGES_CANCEL_PENDING,
  ACCOUNT_CHANGES_CONFIRM,
  ACCOUNT_CHANGES_PENDING,
  ACCOUNT_CHANGES_REQUEST_PROOF,
  ACCOUNT_CHANGES_WAIT,
} from '../../operations/account/changes.js';
import { BaseResource } from '../base.js';
import { requestAccount } from './request.js';

/** Подтверждение смены номера или почты кодом либо облачным паролем. */
export type ContactChangeConfirmation = { changeToken: string } & (
  | { code: string; password?: never }
  | { password: string; code?: never }
);

/** Завершение смены номера или почты и управление отложенными заявками. */
export class AccountChangesResource extends BaseResource {
  /**
   * Запрашивает код на привязанный номер или почту.
   *
   * Возьмите `changeToken` и способ доставки из результата `verifyChange()` или
   * `phone.reverseChangeComplete()`. Полученный код передайте в {@link confirm}.
   */
  requestProof(
    input: { changeToken: string; method: ContactProofMethod },
    options: RequestOptions = {},
  ): Promise<ContactProofDelivery> {
    return requestAccount(
      this.http,
      ACCOUNT_CHANGES_REQUEST_PROOF,
      '/change/proof',
      input,
      options,
    );
  }

  /**
   * Завершает смену номера или почты.
   *
   * Передайте `changeToken` и код из {@link requestProof} либо облачный
   * пароль, если сервер предложил такой способ подтверждения.
   */
  confirm(input: ContactChangeConfirmation, options: RequestOptions = {}): Promise<void> {
    return requestAccount(this.http, ACCOUNT_CHANGES_CONFIRM, '/change/confirm', input, options);
  }

  /**
   * Создаёт отложенную заявку на смену номера или почты.
   *
   * @returns время применения заявки. До этого её можно отменить через {@link cancelPending}
   */
  wait(changeToken: string, options: RequestOptions = {}): Promise<ContactChangeSchedule> {
    return requestAccount(
      this.http,
      ACCOUNT_CHANGES_WAIT,
      '/change/wait',
      { changeToken },
      options,
    );
  }

  /** Возвращает отложенные заявки текущего аккаунта. */
  pending(options: RequestOptions = {}): Promise<PendingContactChange[]> {
    return requestAccount(
      this.http,
      ACCOUNT_CHANGES_PENDING,
      '/change/pending',
      undefined,
      options,
    );
  }

  /**
   * Отменяет отложенную смену.
   *
   * @param requestId идентификатор заявки из {@link pending}
   */
  cancelPending(requestId: string, options: RequestOptions = {}): Promise<void> {
    return requestAccount(
      this.http,
      ACCOUNT_CHANGES_CANCEL_PENDING,
      `/change/pending/${encodeURIComponent(requestId)}`,
      undefined,
      options,
    );
  }
}
