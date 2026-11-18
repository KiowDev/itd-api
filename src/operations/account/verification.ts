import { ItdConfigError } from '../../core/errors.js';
import { pickArray, pickString } from '../../core/unwrap.js';
import { isRecord } from '../../core/validate.js';
import { defineBuiltInOperation } from '../../domain/operations.js';
import type { ContactActionResult, ContactChange } from '../../models/account-access.js';
import { AuthVerificationMode } from '../../models/phone-auth.js';
import { passthroughOperation } from '../common.js';

/** Отделяет ответ смены контакта от результата входа на общем маршруте подтверждения. */
function readContactChange(body: unknown): ContactChange {
  const changeToken = pickString(body, 'changeToken');
  if (
    !isRecord(body) ||
    (body.mode !== undefined && body.mode !== AuthVerificationMode.Change) ||
    !changeToken
  ) {
    throw new ItdConfigError('Сервер не вернул подтверждение смены контакта');
  }

  return {
    changeToken,
    proofs: pickArray(body, 'proofs'),
    ...(typeof body.waitDays === 'number' ? { waitDays: body.waitDays } : {}),
  };
}

export const ACCOUNT_VERIFY_ATTACH =
  passthroughOperation<ContactActionResult>('account.verifyAttach');
export const ACCOUNT_VERIFY_CHANGE = defineBuiltInOperation('account.verifyChange', (body) => {
  if (!isRecord(body) || body.mode !== AuthVerificationMode.Change) {
    throw new ItdConfigError('Сервер не вернул режим смены контакта');
  }
  return readContactChange(body);
});
export const ACCOUNT_PHONE_REVERSE_ATTACH_COMPLETE = passthroughOperation<ContactActionResult>(
  'account.phone.reverseAttachComplete',
);
export const ACCOUNT_PHONE_REVERSE_CHANGE_COMPLETE = defineBuiltInOperation(
  'account.phone.reverseChangeComplete',
  readContactChange,
);
