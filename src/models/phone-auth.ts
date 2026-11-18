import type { Loose } from '../types/enums.js';

/** Назначение контекста согласия телефонного входа. @internal */
export const PHONE_CONSENT_FLOW = 'phone_entry';

/** Назначение ответа общего endpoint подтверждения кода. */
export const AuthVerificationMode = Object.freeze({ SignIn: 'signin', Change: 'change' } as const);

/** Регион, для которого сервер разрешает телефонный вход. */
export interface PhoneRegion {
  /** Код региона, например RU или TM. */
  region: string;
  /** Телефонный код страны без `+`. */
  callingCode: string;
  /** Пример национальной части номера. */
  example: string;
  /** Способы подтверждения, доступные в регионе. */
  methods: PhoneVerificationMethod[];
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
export type PhoneLoginStep = (typeof PhoneLoginStep)[keyof typeof PhoneLoginStep];

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

/** Данные для продолжения проверки номера. */
export interface PhoneFlowInput {
  /** Номер в международном формате с `+`. */
  phone: string;
  /** Значение из ответа на запрос проверки номера. Если после кода нужен пароль, используйте новое значение из ответа. */
  flowToken: string;
}

/** Данные для подтверждения номера после запроса кода. */
export interface PhoneFlowStart extends PhoneDelivery {
  /** Значение для следующих вызовов проверки. Передаётся вместе с тем же номером. */
  flowToken: string;
}

/** Параметры доставки и срок действия восстановленной проверки номера. */
export interface PhoneFlowResume extends PhoneDelivery {
  /** Оставшееся время проверки в секундах. */
  expiresIn: number;
}

/**
 * Подтверждение номера может потребовать облачный пароль.
 * Служебный mode ответа сервера не переносится; результат различается по step/accessToken.
 */
export type PhoneLoginResult =
  | { step: PhoneLoginStep; flowToken: string }
  | { accessToken: string };

/** Доступность исходящего звонка для начатой проверки номера. */
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
