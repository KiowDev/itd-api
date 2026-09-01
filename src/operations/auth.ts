import { ItdConfigError } from '../core/errors.js';
import { pickArray, pickString } from '../core/unwrap.js';
import { defineBuiltInOperation } from '../domain/operations.js';
import type { Session } from '../models/account.js';
import type { AuthState } from '../models/users.js';
import { CaptchaField, CaptchaType } from '../types/enums.js';
import { passthroughOperation, voidOperation } from './common.js';

/** Чем закончился запрос входа. */
export const SignInStatus = Object.freeze({
  Authenticated: 'authenticated',
  OtpRequired: 'otp_required',
} as const);
export type SignInStatus = (typeof SignInStatus)[keyof typeof SignInStatus];

/** Результат входа: готовый токен либо продолжение через код подтверждения. */
export type SignInResult =
  | { status: 'authenticated'; accessToken: string }
  | { status: 'otp_required'; flowToken: string | undefined };

/**
 * Активный провайдер капчи и поле запроса, в котором сервер ждёт токен.
 *
 * Оба значения открытые: провайдер может появиться новый, а имя поля сервер вправе сменить.
 */
export interface CaptchaProvider {
  provider: CaptchaType;
  field: CaptchaField;
}

/**
 * Доказательство прохождения капчи: токен и его провайдер.
 *
 * Имя поля тела запроса SDK подставляет сам — из {@link CaptchaToken.field}, иначе
 * из {@link CAPTCHA_FIELDS}.
 */
export interface CaptchaToken {
  type: CaptchaType;
  token: string;
  /** Поле тела запроса. Нужно, только если сервер переименовал его. */
  field?: CaptchaField | undefined;
}

/**
 * Поле тела запроса по умолчанию для известных провайдеров.
 *
 * Используется, когда провайдера не спрашивали. Ответ `captchaProvider()` важнее этой таблицы.
 */
export const CAPTCHA_FIELDS = Object.freeze({
  [CaptchaType.Itd]: CaptchaField.Itd,
  [CaptchaType.Cloudflare]: CaptchaField.Cloudflare,
} as const);

/** Данные, из которых клиент строит QR-код входа. */
export interface QrLoginStart {
  qrId: string;
  claimToken: string;
  payload: string;
  expiresIn: number;
  captchaRequired: boolean;
}

/** Состояния, которые может вернуть проверка QR-входа. */
export const QrLoginStatus = Object.freeze({
  Pending: 'pending',
  Scanned: 'scanned',
  CaptchaRequired: 'captcha_required',
  Authorized: 'authorized',
  Rejected: 'rejected',
} as const);
export type QrLoginStatus = (typeof QrLoginStatus)[keyof typeof QrLoginStatus];

/** Результат проверки QR-входа. */
export type QrLoginClaim =
  | { status: 'authorized'; accessToken: string; expiresIn?: number }
  | {
      status: 'pending' | 'scanned' | 'captcha_required' | 'rejected';
      expiresIn?: number;
    };

/** Состояния, приходящие из потокового наблюдения за QR-входом. */
export const QrLoginStreamStatus = Object.freeze({
  Pending: 'pending',
  Scanned: 'scanned',
  Approved: 'approved',
  Rejected: 'rejected',
} as const);
export type QrLoginStreamStatus = (typeof QrLoginStreamStatus)[keyof typeof QrLoginStreamStatus];

/** Одно событие `POST /api/v1/auth/qr/stream`. */
export interface QrLoginStreamEvent {
  status: QrLoginStreamStatus;
  expiresIn?: number;
}

function requireString(body: unknown, key: string, message: string): string {
  const value = pickString(body, key);
  if (!value) throw new ItdConfigError(message);
  return value;
}

export const AUTH_CHECK = passthroughOperation<AuthState>('auth.check');
export const AUTH_CAPTCHA_PROVIDER = passthroughOperation<CaptchaProvider>('auth.captchaProvider');
export const AUTH_SIGN_UP = defineBuiltInOperation<string>('auth.signUp', (body) =>
  requireString(body, 'flowToken', 'Сервер не вернул flowToken при регистрации'),
);
export const AUTH_SIGN_IN = defineBuiltInOperation<SignInResult>('auth.signIn', (body) => {
  const accessToken = pickString(body, 'accessToken');
  return accessToken
    ? { status: SignInStatus.Authenticated, accessToken }
    : { status: SignInStatus.OtpRequired, flowToken: pickString(body, 'flowToken') };
});
export const AUTH_VERIFY_OTP = defineBuiltInOperation<string>('auth.verifyOtp', (body) =>
  requireString(body, 'accessToken', 'Сервер не вернул accessToken после подтверждения кода'),
);
export const AUTH_REFRESH = defineBuiltInOperation<string>('auth.refresh', (body) =>
  requireString(body, 'accessToken', 'Сервер не вернул accessToken при обновлении сессии'),
);
export const AUTH_RESEND_OTP = voidOperation('auth.resendOtp');
export const AUTH_LOGOUT = voidOperation('auth.logout');
export const AUTH_FORGOT_PASSWORD = defineBuiltInOperation<string>('auth.forgotPassword', (body) =>
  requireString(body, 'flowToken', 'Сервер не вернул flowToken при запросе сброса пароля'),
);
export const AUTH_RESET_PASSWORD = voidOperation('auth.resetPassword');
export const AUTH_CHANGE_PASSWORD = voidOperation('auth.changePassword');
export const AUTH_SESSIONS = defineBuiltInOperation<Session[]>('auth.sessions', (body) =>
  pickArray<Session>(body, 'sessions'),
);
export const AUTH_REVOKE_SESSION = voidOperation('auth.revokeSession');
export const AUTH_REVOKE_OTHER_SESSIONS = voidOperation('auth.revokeOtherSessions');
export const AUTH_QR_START = passthroughOperation<QrLoginStart>('auth.qrStart');
export const AUTH_QR_CLAIM = passthroughOperation<QrLoginClaim>('auth.qrClaim');
