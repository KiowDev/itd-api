import type { QrLoginSecrets } from 'itd-api';
import { modelContext } from '../runtime/context.js';
import type { AnyRecord } from '../runtime/records.js';

/**
 * Секреты кода, из которого получено описание устройства.
 *
 * Сам ответ сервера их не содержит, поэтому они запоминаются на стороне пакета: без них
 * подтвердить или отклонить вход нечем.
 */
const QR_SECRETS = new WeakMap<object, QrLoginSecrets>();

/** Связывает описание устройства с секретами кода, по которому оно получено. */
export function rememberQrSecrets(target: object, secrets: QrLoginSecrets): void {
  QR_SECRETS.set(target, { qrId: secrets.qrId, secret: secrets.secret });
}

function secretsOf(target: AnyRecord): QrLoginSecrets {
  const secrets = QR_SECRETS.get(target);
  if (!secrets) {
    throw new TypeError('Секреты QR-кода неизвестны: модель получена не через scanQrLogin()');
  }
  return secrets;
}

function approve(this: AnyRecord, ...args: unknown[]): unknown {
  const context = modelContext(this);
  return context.hydrate(
    Reflect.apply(context.client.auth.approveQrLogin, context.client.auth, [
      secretsOf(this),
      ...args,
    ]) as unknown,
  );
}

function reject(this: AnyRecord, ...args: unknown[]): unknown {
  const context = modelContext(this);
  return context.hydrate(
    Reflect.apply(context.client.auth.rejectQrLogin, context.client.auth, [
      secretsOf(this),
      ...args,
    ]) as unknown,
  );
}

export const QR_LOGIN_TARGET_ACTIONS = Object.freeze({ approve, reject });
