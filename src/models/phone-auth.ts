import type { Loose } from '../types/enums.js';

/** Назначение контекста согласия телефонного входа. @internal */
export const PHONE_CONSENT_FLOW = 'phone_entry';

/** Назначение ответа общего endpoint подтверждения кода. */
export const AuthVerificationMode = Object.freeze({ SignIn: 'signin', Change: 'change' } as const);
export type AuthVerificationMode = (typeof AuthVerificationMode)[keyof typeof AuthVerificationMode];

/** Регион, для которого сервер разрешает телефонный вход. */
export interface PhoneRegion {
  /** Код региона, например RU или TM. */
  region: string;
  /** Телефонный код страны без `+`. */
  callingCode: string;
  /** Пример национальной части номера. */
  example: string;
}

/** Серверный список регионов, доступных для телефонного входа. */
export interface PhoneConfig {
  regions: PhoneRegion[];
  defaultRegion: string;
}

/** Редакция документа, включённая в контекст согласия. */
export interface ConsentDocument {
  scope: string;
  slug: string;
  version: string;
  contentSha256: string;
  url: string;
}

/** Текст и редакции документов, с которыми пользователь соглашается при входе. */
export interface PhoneConsent {
  /** Версия протокола из consent(); передаётся серверу вместе с contextToken. */
  protocolVersion: number;
  /** Подписанный контекст; в start() передаётся без изменения. */
  contextToken: string;
  id: string;
  /** Время выдачи контекста, Unix-время в миллисекундах. */
  issuedAt: number;
  /** Срок действия контекста, Unix-время в миллисекундах. */
  expiresAt: number;
  bundle: {
    id: string;
    flow: typeof PHONE_CONSENT_FLOW;
    documents: ConsentDocument[];
    actions: Record<string, string>;
    actionVersion: string;
    submitLabel: string;
    text: { text: string; document?: string }[];
  };
}

/** Серверные каналы доставки кода. */
export const PhoneDeliveryChannel = Object.freeze({
  MissedCall: 'missed_call',
  VoiceCall: 'voice_call',
  Sms: 'sms',
  Push: 'push',
} as const);
export type PhoneDeliveryChannel = Loose<
  (typeof PhoneDeliveryChannel)[keyof typeof PhoneDeliveryChannel]
>;

/** Подтверждение входящим кодом либо исходящим звонком пользователя. */
export const PhoneVerificationMethod = Object.freeze({
  Direct: 'direct',
  Reverse: 'reverse',
} as const);
export type PhoneVerificationMethod =
  (typeof PhoneVerificationMethod)[keyof typeof PhoneVerificationMethod];

/** Продолжение телефонного входа, ещё не выдавшее access token. */
export const PhoneLoginStep = Object.freeze({ Password: 'password' } as const);

/** Как получить код и когда можно повторить запрос. */
export interface PhoneDelivery {
  channel: PhoneDeliveryChannel;
  /** Число цифр кода; может измениться после resend(). */
  codeLength: number;
  /** Пауза до повторной доставки, в секундах. */
  retryIn: number;
  /** Ввод кода недоступен: требуется исходящий звонок. */
  reverseOnly?: boolean;
  /** Канал следующей доставки либо null, если сервер его не указал. */
  nextChannel: PhoneDeliveryChannel | null;
}

/** Параметры проверки номера после start(). */
export interface PhoneLoginStart extends PhoneDelivery {
  /** Секрет потока, который передают в последующие операции вместе с номером. */
  flowToken: string;
}

/**
 * Подтверждение номера может потребовать облачный пароль.
 * Служебный mode ответа сервера не переносится; результат различается по step/accessToken.
 */
export type PhoneLoginResult =
  | { step: typeof PhoneLoginStep.Password; flowToken: string }
  | { accessToken: string };

/** Доступность исходящего звонка для уже начатого телефонного потока. */
export interface PhoneReverseOptions {
  available: boolean;
  /** Время до доступности способа, в секундах. */
  availableIn: number;
}

/** Состояния подтверждения номера исходящим звонком. */
export const PhoneReverseState = Object.freeze({
  NotStarted: 'not_started',
  Preparing: 'preparing',
  Waiting: 'waiting',
  Confirmed: 'confirmed',
  Expired: 'expired',
  Failed: 'failed',
} as const);
export type PhoneReverseState = Loose<(typeof PhoneReverseState)[keyof typeof PhoneReverseState]>;

/** Состояние звонка; само confirmed ещё не завершает вход. */
export interface PhoneReverseStatus {
  state: PhoneReverseState;
  /** Оставшееся время подтверждения, в секундах. */
  expiresIn: number;
  /** Номер для исходящего звонка, если он уже подготовлен. */
  phone: string | null;
  /** Оставшиеся попытки звонка, если сервер поддерживает их счётчик. */
  attemptsLeft?: number;
}
