import type { Loose } from '../types/enums.js';
import type { IsoDate, UserId } from './common.js';

/** Состояние платной подписки и её цена. */
export interface Subscription {
  /** Активна ли подписка. */
  active: boolean;
  /** Включено ли автопродление. */
  recurringEnabled: boolean;
  /** Цена в рублях. */
  price: number;
}

/** Известные типы способов оплаты. */
export const PaymentMethodType = Object.freeze({
  /** Банковская карта. */
  BankCard: 'bank_card',
} as const);
export type PaymentMethodType = Loose<(typeof PaymentMethodType)[keyof typeof PaymentMethodType]>;

/** Сохранённый способ оплаты. */
export interface PaymentMethod {
  /** Идентификатор, который можно передать при оплате подписки. */
  id: string;
  /** Тип способа оплаты. */
  type?: PaymentMethodType;
  /** Последние четыре цифры карты. */
  cardLast4?: string | null;
  /** Платёжная система карты. */
  cardBrand?: string | null;
  /** Последние четыре цифры карты, также доступны как `cardLast4`. */
  last4?: string;
  /** Платёжная система, также доступна как `cardBrand`. */
  brand?: string;
  /** Можно ли использовать этот способ для автопродления. */
  canAutoRenew?: boolean;
  /** Выбран ли этот способ оплаты основным. */
  isDefault?: boolean;
  /** Когда способ оплаты был добавлен. */
  createdAt?: IsoDate;
  /** Когда истекает срок действия способа оплаты. */
  expiresAt?: IsoDate | null;
}

/** Для кого оформляется подписка. */
export const SubscriptionCheckoutKind = Object.freeze({
  /** Покупка для себя. */
  Self: 'self',
  /** Подарок другому пользователю. */
  Gift: 'gift',
} as const);
export type SubscriptionCheckoutKind =
  (typeof SubscriptionCheckoutKind)[keyof typeof SubscriptionCheckoutKind];

/** Состояние оформления или попытки оплаты. */
export const SubscriptionCheckoutStatus = Object.freeze({
  /** Можно выбрать предложение и начать оплату. */
  Ready: 'ready',
  /** Платёж ждёт подтверждения. */
  Pending: 'pending',
  /** Платёж обрабатывается. */
  Processing: 'processing',
  /** Оплата завершена. */
  Succeeded: 'succeeded',
  /** Платёж отменён. */
  Canceled: 'canceled',
  /** Платёж завершился ошибкой. */
  Failed: 'failed',
  /** Платёж требует проверки. */
  ReviewRequired: 'review_required',
} as const);
export type SubscriptionCheckoutStatus = Loose<
  (typeof SubscriptionCheckoutStatus)[keyof typeof SubscriptionCheckoutStatus]
>;

/** Покупка себе или подарок конкретному пользователю. */
export type SubscriptionCheckoutSubject =
  | {
      /** Покупка для себя. */
      kind: (typeof SubscriptionCheckoutKind)['Self'];
      /** Для покупки себе достаточно указать сценарий. */
      recipientUserId?: never;
    }
  | {
      /** Покупка в подарок. */
      kind: (typeof SubscriptionCheckoutKind)['Gift'];
      /** ID получателя подарка. */
      recipientUserId: UserId;
    };

/** Цена и срок подписки. Суммы указаны в минимальных единицах валюты. */
export interface SubscriptionOffer {
  /** Срок подписки в месяцах. */
  months: number;
  /** Сумма первого платежа. */
  initialAmountMinor: number;
  /** Код валюты первого платежа. */
  currency: string;
  /** Версия предложения, которую нужно передать при оформлении. */
  quoteVersion: string;
  /** На сколько месяцев продлевается подписка при следующем списании. */
  renewalMonths: number;
  /** Сумма следующего списания. */
  renewalAmountMinor: number;
  /** Код валюты следующего списания. */
  renewalCurrency: string;
}

/** Известные платёжные сервисы. */
export const SubscriptionPaymentProvider = Object.freeze({
  /** ЮKassa. */
  YooKassa: 'yookassa',
  /** bePaid. */
  BePaid: 'bepaid',
} as const);
export type SubscriptionPaymentProvider = Loose<
  (typeof SubscriptionPaymentProvider)[keyof typeof SubscriptionPaymentProvider]
>;

/** Условия, зафиксированные для попытки оплаты. */
export interface SubscriptionQuote extends SubscriptionOffer {
  /** Платёжный сервис. */
  provider: SubscriptionPaymentProvider;
  /** Включено ли автопродление для этой покупки. */
  autoRenewal: boolean;
  /** Версия согласия на автопродление. */
  consentVersion: string | null;
  /** Контрольная сумма зафиксированных условий оплаты. */
  fingerprint?: string;
  /** ID получателя, если подписка оформляется в подарок. */
  recipientUserId?: UserId | null;
}

/** Согласие на автопродление и параметры следующего списания. */
export interface SubscriptionRenewalAgreement {
  /** Включено ли автопродление. */
  enabled: boolean;
  /** Платёжный сервис для автопродления. */
  provider: SubscriptionPaymentProvider | null;
  /** Идентификатор стороны, которая управляет автопродлением. */
  owner: string | null;
  /** Можно ли предложить включить автопродление. */
  canOffer: boolean;
  /** Принял ли пользователь согласие на автопродление. */
  hasAcceptedConsent: boolean;
  /** Нужно ли принять новую версию согласия. */
  requiresNewConsent: boolean;
  /** Версия согласия, которую нужно передать при включении автопродления. */
  consentVersion: string | null;
  /** Дата следующего списания. */
  nextChargeAt: IsoDate | null;
  /** Когда придёт напоминание о списании. */
  reminderAt: IsoDate | null;
  /** На сколько месяцев продлевается подписка при списании. */
  renewalMonths: number;
  /** Сумма списания в минимальных единицах валюты. */
  renewalAmountMinor: number;
  /** Код валюты списания. */
  renewalCurrency: string;
}

/** Предложения и текущая попытка оформления. */
export interface SubscriptionCheckoutState {
  /** Покупка для себя или в подарок. */
  kind: SubscriptionCheckoutKind;
  /** Сценарий оформления и ID получателя подарка. */
  subject:
    | {
        /** Покупка для себя. */
        kind: (typeof SubscriptionCheckoutKind)['Self'];
        /** Для покупки себе сервер возвращает `null`. */
        recipientUserId: null;
      }
    | {
        /** Покупка в подарок. */
        kind: (typeof SubscriptionCheckoutKind)['Gift'];
        /** ID получателя подарка. */
        recipientUserId: UserId;
      };
  /** Текущее состояние оформления. */
  state: SubscriptionCheckoutStatus;
  /** Доступные сроки и цены. */
  offers: SubscriptionOffer[];
  /** Условия автопродления. */
  agreement: SubscriptionRenewalAgreement;
  /** Когда заканчивается действующая подписка. */
  actualExpiresAt: IsoDate | null;
  /** Дата следующего списания. */
  nextChargeAt: IsoDate | null;
  /** Когда придёт напоминание о списании. */
  reminderAt: IsoDate | null;
  /** Условия текущей попытки оплаты. */
  quote: SubscriptionQuote | null;
  /** Идентификатор текущей попытки оплаты. */
  attemptId: string | null;
  /** Можно ли изменить условия оформления. */
  canEditTerms: boolean;
  /** Можно ли начать новую попытку оплаты. */
  canStartNewAttempt: boolean;
  /** Можно ли освободить текущую попытку через `releaseCheckout()`. */
  canReleaseAttempt?: boolean;
  /** Ссылка для подтверждения оплаты. */
  confirmationUrl?: string | null;
  /** Код причины текущего состояния оформления. */
  reasonCode?: string;
}

/** Общие поля попытки оплаты подписки или подарка. */
interface SubscriptionCheckoutAttempt {
  /** Состояние платежа. */
  status: SubscriptionCheckoutStatus;
  /** Зафиксированные условия оплаты. */
  quote: SubscriptionQuote;
  /** Ссылка для подтверждения оплаты. */
  confirmationUrl?: string | null;
  /** Дата окончания подписки. */
  actualExpiresAt?: IsoDate | null;
  /** Дата следующего списания. */
  nextChargeAt?: IsoDate | null;
  /** Когда придёт напоминание о списании. */
  reminderAt?: IsoDate | null;
}

/** Состояние оплаты своей подписки. */
export interface SubscriptionPayment extends SubscriptionCheckoutAttempt {
  /** ID платежа для проверки его состояния. */
  paymentId: string;
  /** Подтверждена ли оплата. */
  paid?: boolean;
}

/** Состояние оплаты подарка. */
export interface SubscriptionGift extends SubscriptionCheckoutAttempt {
  /** ID подарка для проверки его состояния. */
  giftId: string;
  /** ID получателя подарка. */
  recipientUserId?: UserId | null;
}

/** Срок и цена предложения международной оплаты. */
export interface InternationalSubscriptionOffer {
  /** Срок подписки в месяцах. */
  months: number;
  /** Цена в белорусских копейках. */
  amountMinor: number;
  /** Цена в центах США. */
  usdAmountMinor?: number;
}

/** Доступность международной оплаты и цены для каждого сценария. */
export interface InternationalSubscriptionCapability {
  /** Доступна ли международная оплата. */
  enabled: boolean;
  /** Используется ли тестовая платёжная среда. */
  test: boolean;
  /** Доступные предложения для покупки себе и в подарок. */
  offers?: Record<SubscriptionCheckoutKind, InternationalSubscriptionOffer[]>;
  /** Обменный курс для показа цены в долларах. */
  usdRate?: {
    /** Сколько белорусских рублей стоит один доллар США. */
    bynPerUsd: number;
    /** До какого времени действует курс. */
    validUntil: IsoDate;
  } | null;
  /** Условия международного автопродления. */
  renewal?: {
    /** Сумма списания в белорусских копейках. */
    amountMinor: number;
    /** Версия согласия на автопродление. */
    consentVersion: string;
  } | null;
}

/** Результат запроса международной оплаты. */
export const InternationalSubscriptionCheckoutMode = Object.freeze({
  /** Доступна информационная страница. */
  Informational: 'informational',
  /** Доступна форма перехода к оплате. */
  Checkout: 'checkout',
} as const);

/** Ссылка на информационную страницу либо данные для отправки формы оплаты. */
export type InternationalSubscriptionCheckout = {
  /** Адрес страницы для перехода. */
  handoffUrl: string;
  /** Срок подписки выбирается на платёжной странице. */
  termSelection: 'landing';
} & (
  | {
      /** Доступна информационная страница. */
      mode: (typeof InternationalSubscriptionCheckoutMode)['Informational'];
      /** Режим просмотра условий. */
      paymentsEnabled: false;
    }
  | {
      /** Доступна форма перехода к оплате. */
      mode: (typeof InternationalSubscriptionCheckoutMode)['Checkout'];
      /** Можно перейти к оплате. */
      paymentsEnabled: true;
      /** Параметры формы перехода к оплате. */
      handoff: {
        /** HTTP-метод отправки формы. */
        method: 'POST';
        /** Адрес отправки формы. */
        url: string;
        /** Поля формы. */
        fields: {
          /** Билет перехода, выданный сервером. */
          handoffTicket: string;
        };
        /** До какого времени действует билет перехода. */
        expiresAt: IsoDate;
      };
    }
);
