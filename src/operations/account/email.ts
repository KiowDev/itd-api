import { ItdConfigError } from '../../core/errors.js';
import { pickString } from '../../core/unwrap.js';
import { defineBuiltInOperation } from '../../domain/operations.js';
import { voidOperation } from '../common.js';

/** Извлекает токен для подтверждения адреса почты. */
function readEmailFlow(body: unknown): string {
  const flowToken = pickString(body, 'flowToken');
  if (!flowToken) throw new ItdConfigError('Сервер не вернул flowToken для подтверждения почты');
  return flowToken;
}

export const ACCOUNT_EMAIL_ATTACH = defineBuiltInOperation('account.email.attach', readEmailFlow);
export const ACCOUNT_EMAIL_START_CHANGE = defineBuiltInOperation(
  'account.email.startChange',
  readEmailFlow,
);
export const ACCOUNT_EMAIL_RESEND_OTP = voidOperation('account.email.resendOtp');
