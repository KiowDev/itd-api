import { ItdConfigError } from '../core/errors.js';
import { pickString } from '../core/unwrap.js';
import type { PhoneDelivery, PhoneDeliveryChannel, PhoneFlowStart } from '../models/phone-auth.js';

/** Приводит вложенные и плоские параметры доставки к одному результату. */
export function readPhoneDelivery(body: unknown): PhoneDelivery {
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

/** Извлекает `flowToken` и параметры доставки после запуска проверки номера. */
export function readPhoneStart(body: unknown): PhoneFlowStart {
  const flowToken = pickString(body, 'flowToken');
  if (!flowToken) throw new ItdConfigError('Сервер не вернул flowToken для проверки номера');
  return { ...readPhoneDelivery(body), flowToken };
}
