import type { QrLoginSecrets, QrLoginTarget } from 'itd-api';
import { QR_LOGIN_TARGET_ACTIONS, rememberQrSecrets } from '../actions/qr-login.js';
import { decorateWith } from '../decorate.js';
import type { HydrationContext } from '../runtime/context.js';
import { type AnyRecord, isObject } from '../runtime/records.js';

type ScanQrLogin = (...args: never[]) => Promise<QrLoginTarget>;

/**
 * Довешивает `approve()` и `reject()` на описание устройства из `scanQrLogin()`.
 *
 * Секреты кода приходят аргументом вызова, а не полем ответа, поэтому действия
 * привязываются здесь, а не при обычном распознавании модели по форме.
 */
function withQrActions(scan: ScanQrLogin, context: HydrationContext): ScanQrLogin {
  return (async (secrets: QrLoginSecrets, ...rest: never[]) => {
    const target = (await Reflect.apply(scan, undefined, [secrets, ...rest])) as QrLoginTarget;
    if (isObject(target) && isObject(secrets)) {
      rememberQrSecrets(target, secrets);
      decorateWith(target as unknown as AnyRecord, QR_LOGIN_TARGET_ACTIONS, context);
    }
    return target;
  }) as unknown as ScanQrLogin;
}

/** Оборачивает уже гидратированный ресурс авторизации, оставляя остальные методы как есть. */
export function authFacade(resource: object, context: HydrationContext): object {
  let scan: unknown;

  return new Proxy(resource, {
    get(target, property, receiver) {
      const member = Reflect.get(target, property, receiver) as unknown;
      if (property !== 'scanQrLogin' || typeof member !== 'function') return member;

      scan ??= withQrActions(member as ScanQrLogin, context);
      return scan;
    },
  });
}
