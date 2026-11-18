import { ItdConfigError } from '../../core/errors.js';
import { pickString } from '../../core/unwrap.js';
import { isRecord } from '../../core/validate.js';
import { defineBuiltInOperation } from '../../domain/operations.js';
import {
  AuthVerificationMode,
  type PhoneConfig,
  type PhoneConsent,
  type PhoneFlowResume,
  type PhoneFlowStart,
  type PhoneLoginResult,
  PhoneLoginStep,
  type PhoneReverseOptions,
  type PhoneReverseStatus,
} from '../../models/phone-auth.js';
import { passthroughOperation } from '../common.js';
import { readPhoneDelivery, readPhoneStart } from '../phone-flow.js';

/** Отклоняет неизвестный контракт до принятия результата входа. */
function invalidResponse(): never {
  throw new ItdConfigError('Сервер вернул неподдерживаемый ответ телефонного входа');
}

/** Требует непустой секрет для продолжения телефонного потока. */
function readFlowToken(body: unknown): string {
  const value = pickString(body, 'flowToken');
  if (!value) return invalidResponse();
  return value;
}

/** Разделяет access token и шаг пароля; режимы привязки/смены контакта не принимает. */
function readLoginResult(body: unknown): PhoneLoginResult {
  if (!isRecord(body)) return invalidResponse();
  if (body.mode !== undefined && body.mode !== AuthVerificationMode.SignIn)
    return invalidResponse();
  const accessToken = pickString(body, 'accessToken');
  if (accessToken) return { accessToken };
  if (body.step === PhoneLoginStep.Password) {
    return { step: PhoneLoginStep.Password, flowToken: readFlowToken(body) };
  }
  return invalidResponse();
}

/** Для завершения по паролю промежуточный шаг вместо access token недопустим. */
function readAccessToken(body: unknown): string {
  const result = readLoginResult(body);
  if (!('accessToken' in result)) return invalidResponse();
  return result.accessToken;
}

export const AUTH_PHONE_CONFIG = passthroughOperation<PhoneConfig>('auth.phone.config');
export const AUTH_PHONE_CONSENT = passthroughOperation<PhoneConsent>('auth.phone.consent');
export const AUTH_PHONE_START = defineBuiltInOperation<PhoneFlowStart>(
  'auth.phone.start',
  readPhoneStart,
);
export const AUTH_PHONE_RESUME = defineBuiltInOperation<PhoneFlowResume>(
  'auth.phone.resume',
  (body) => ({ ...readPhoneDelivery(body), expiresIn: (body as PhoneFlowResume).expiresIn }),
);
export const AUTH_PHONE_VERIFY = defineBuiltInOperation('auth.phone.verify', readLoginResult);
export const AUTH_PHONE_PASSWORD = defineBuiltInOperation('auth.phone.password', readAccessToken);
export const AUTH_PHONE_RESET_PASSWORD = defineBuiltInOperation(
  'auth.phone.resetPassword',
  readAccessToken,
);
export const AUTH_PHONE_RESEND = defineBuiltInOperation('auth.phone.resend', readPhoneDelivery);
export const AUTH_PHONE_REVERSE_OPTIONS = passthroughOperation<PhoneReverseOptions>(
  'auth.phone.reverseOptions',
);
export const AUTH_PHONE_REVERSE_START =
  passthroughOperation<PhoneReverseStatus>('auth.phone.reverseStart');
export const AUTH_PHONE_REVERSE_STATUS = passthroughOperation<PhoneReverseStatus>(
  'auth.phone.reverseStatus',
);
export const AUTH_PHONE_REVERSE_COMPLETE = defineBuiltInOperation(
  'auth.phone.reverseComplete',
  readLoginResult,
);
