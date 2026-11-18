import type { Loose } from '../types/enums.js';
import type { PhoneDeliveryChannel } from './phone-auth.js';

/** Привязанные номер и почта и наличие облачного пароля. */
export interface AccountInfo {
  /** Привязанная почта. */
  email: string | null;
  /** Привязанный номер телефона. */
  phone: string | null;
  /** Установлен ли облачный пароль. */
  hasPassword: boolean;
}

/** Способ подтверждения смены номера или почты. */
export const ContactProofMethod = Object.freeze({
  Password: 'password',
  EmailCode: 'email_code',
  PhoneCode: 'phone_code',
} as const);
export type ContactProofMethod = Loose<
  (typeof ContactProofMethod)[keyof typeof ContactProofMethod]
>;

/** Способы завершить смену после проверки нового номера или адреса почты. */
export interface ContactChange {
  /** Передайте это значение в `requestProof()`, `confirm()` или `wait()`. */
  changeToken: string;
  proofs: ContactProofMethod[];
  /** Период ожидания, если его указал сервер. */
  waitDays?: number;
}

/** Доставка кода подтверждения на привязанный номер или почту. */
export interface ContactProofDelivery {
  sentTo: string;
  delivery?: { type: PhoneDeliveryChannel; codeLength: number } | null;
}

/** Время, когда сервер применит отложенную смену. */
export interface ContactChangeSchedule {
  appliesAt: string | number;
}

/** Что меняет отложенная заявка: номер или почту. */
export const ContactKind = Object.freeze({ Email: 'email', Phone: 'phone' } as const);
export type ContactKind = Loose<(typeof ContactKind)[keyof typeof ContactKind]>;

/** Отложенная заявка, которую ещё можно отменить. */
export interface PendingContactChange extends ContactChangeSchedule {
  id: string;
  kind: ContactKind;
  newIdentifier: string;
}

/** Результат привязки номера или почты. Также возвращается после синхронизации номера. */
export interface ContactActionResult {
  success: boolean;
}
