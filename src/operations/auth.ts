import { ItdConfigError } from '../core/errors.js';
import { pickArray, pickString } from '../core/unwrap.js';
import { defineBuiltInOperation } from '../domain/operations.js';
import type { Session } from '../models/account.js';
import type { AuthState } from '../models/users.js';
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

function requireString(body: unknown, key: string, message: string): string {
  const value = pickString(body, key);
  if (!value) throw new ItdConfigError(message);
  return value;
}

export const AUTH_CHECK = passthroughOperation<AuthState>('auth.check');
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
export const AUTH_REFRESH = defineBuiltInOperation<string | undefined>('auth.refresh', (body) =>
  pickString(body, 'accessToken'),
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
