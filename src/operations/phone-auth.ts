import { ItdConfigError } from '../core/errors.js';
import { pickString } from '../core/unwrap.js';
import { isRecord } from '../core/validate.js';
import { defineBuiltInOperation } from '../domain/operations.js';
import {
  AuthVerificationMode,
  type PhoneConfig,
  type PhoneConsent,
  type PhoneDelivery,
  type PhoneDeliveryChannel,
  type PhoneLoginResult,
  type PhoneLoginStart,
  PhoneLoginStep,
  type PhoneReverseOptions,
  type PhoneReverseStatus,
} from '../models/phone-auth.js';
import { passthroughOperation } from './common.js';

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

/** Приводит вложенные и плоские параметры доставки к одному результату. */
function readDelivery(body: unknown): PhoneDelivery {
  const response = body as PhoneDelivery & {
    delivery?: { type: PhoneDeliveryChannel; codeLength: number };
    next?: PhoneDeliveryChannel | null;
  };
  const next = response.next ?? response.nextChannel;
  return {
    channel: response.delivery?.type ?? response.channel,
    codeLength: response.delivery?.codeLength ?? response.codeLength,
    retryIn: response.retryIn,
    ...(response.reverseOnly === true ? { reverseOnly: true } : {}),
    nextChannel: next ?? null,
  };
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
export const AUTH_PHONE_START = defineBuiltInOperation<PhoneLoginStart>(
  'auth.phone.start',
  (body) => ({
    ...readDelivery(body),
    flowToken: readFlowToken(body),
  }),
);
export const AUTH_PHONE_VERIFY = defineBuiltInOperation('auth.phone.verify', readLoginResult);
export const AUTH_PHONE_PASSWORD = defineBuiltInOperation('auth.phone.password', readAccessToken);
export const AUTH_PHONE_RESET_PASSWORD = defineBuiltInOperation(
  'auth.phone.resetPassword',
  readAccessToken,
);
export const AUTH_PHONE_RESEND = defineBuiltInOperation('auth.phone.resend', readDelivery);
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
