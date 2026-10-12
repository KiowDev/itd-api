import type { QrLoginSecrets } from 'itd-api';
import type { ModelAction } from '../../actions/action.types.js';
import { modelContext } from '../../runtime/context.utils.js';
import type { AnyRecord } from '../../runtime/records.types.js';
import { isObject } from '../../runtime/records.utils.js';
import type { HydratedQrLoginTargetActions } from './qr-login.types.js';

/** Секреты кода, из которого получено описание устройства: ответ сервера их не содержит. */
const QR_SECRETS = new WeakMap<object, QrLoginSecrets>();

/** Запоминает секреты из аргументов `scanQrLogin(secrets)` для описания устройства. */
export function rememberQrSecrets(target: object, [secrets]: readonly unknown[]): void {
  if (!isObject(secrets)) return;
  const { qrId, secret } = secrets as QrLoginSecrets;
  QR_SECRETS.set(target, { qrId, secret });
}

function secretsOf(target: AnyRecord): QrLoginSecrets {
  const secrets = QR_SECRETS.get(target);
  if (!secrets) {
    throw new TypeError('Секреты QR-кода неизвестны: модель получена не через scanQrLogin()');
  }
  return secrets;
}

function approve(this: AnyRecord, ...args: unknown[]): unknown {
  const { auth } = modelContext(this).facade;
  return Reflect.apply(auth.approveQrLogin, auth, [secretsOf(this), ...args]);
}

function reject(this: AnyRecord, ...args: unknown[]): unknown {
  const { auth } = modelContext(this).facade;
  return Reflect.apply(auth.rejectQrLogin, auth, [secretsOf(this), ...args]);
}

export const QR_LOGIN_TARGET_ACTIONS = Object.freeze({
  approve,
  reject,
} satisfies Record<keyof HydratedQrLoginTargetActions, ModelAction>);
