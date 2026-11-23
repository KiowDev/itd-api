import type { RequestOptions } from '../core/options.js';
import { encodePathSegment } from '../core/url.js';
import { defineBuiltInOperation } from '../domain/operations.js';
import type { UserId } from '../models/common.js';
import {
  type InternationalSubscriptionCapability,
  type InternationalSubscriptionCheckout,
  type PaymentMethod,
  PaymentMethodType,
  type Subscription,
  type SubscriptionCheckoutState,
  type SubscriptionCheckoutSubject,
  type SubscriptionGift,
  type SubscriptionPayment,
} from '../models/subscription.js';
import { passthroughOperation, voidOperation } from '../operations/common.js';
import { BaseResource } from './base.js';

/** Версия протокола оплаты по выбранному предложению. */
const SUBSCRIPTION_CHECKOUT_VERSION = 2;

const SUBSCRIPTION_METHODS = defineBuiltInOperation<PaymentMethod[]>(
  'subscription.methods',
  (body) =>
    Array.isArray(body)
      ? (body as PaymentMethod[]).map((method) => ({
          ...method,
          ...(method.last4 === undefined && method.cardLast4 != null
            ? { last4: method.cardLast4 }
            : {}),
          ...(method.brand === undefined && method.cardBrand != null
            ? { brand: method.cardBrand }
            : {}),
        }))
      : [],
);
const SUBSCRIPTION_STATUS = passthroughOperation<Subscription>('subscription.status');
const SUBSCRIPTION_CHECKOUT_STATE = passthroughOperation<SubscriptionCheckoutState>(
  'subscription.checkoutState',
);
const SUBSCRIPTION_PAYMENT = passthroughOperation<SubscriptionPayment>('subscription.payment');
const SUBSCRIPTION_GIFT = passthroughOperation<SubscriptionGift>('subscription.gift');
const SUBSCRIPTION_GIFT_GIVER = passthroughOperation<{ giftsGiven: number }>(
  'subscription.giftGiver',
);
const SUBSCRIPTION_INTERNATIONAL_CAPABILITY =
  passthroughOperation<InternationalSubscriptionCapability>(
    'subscription.internationalCheckoutCapability',
  );
const SUBSCRIPTION_PAY = passthroughOperation<unknown>('subscription.pay');
const SUBSCRIPTION_PAY_CHECKOUT = passthroughOperation<SubscriptionPayment>(
  'subscription.payCheckout',
);
const SUBSCRIPTION_CREATE_GIFT = passthroughOperation<SubscriptionGift>('subscription.createGift');
const SUBSCRIPTION_RELEASE_CHECKOUT = passthroughOperation<{ released: boolean }>(
  'subscription.releaseCheckout',
);
const SUBSCRIPTION_INTERNATIONAL_CHECKOUT = passthroughOperation<InternationalSubscriptionCheckout>(
  'subscription.internationalCheckout',
);
const SUBSCRIPTION_RESUME_INTERNATIONAL_CHECKOUT = passthroughOperation<{ checkoutUrl: string }>(
  'subscription.resumeInternationalCheckout',
);
const SUBSCRIPTION_RELEASE_INTERNATIONAL_CHECKOUT = passthroughOperation<{ released: boolean }>(
  'subscription.releaseInternationalCheckout',
);
const SUBSCRIPTION_SET_AUTO_RENEWAL = passthroughOperation<unknown>('subscription.setAutoRenewal');
const SUBSCRIPTION_BIND_CARD = passthroughOperation<unknown>('subscription.bindCard');
const SUBSCRIPTION_SET_DEFAULT_METHOD = passthroughOperation<unknown>(
  'subscription.setDefaultMethod',
);
const SUBSCRIPTION_REMOVE_METHOD = voidOperation('subscription.removeMethod');

/** Для кого оформляется подписка и с каким ключом попытки. */
export type SubscriptionCheckoutInput = SubscriptionCheckoutSubject & {
  /** Ключ попытки, используемый и при последующем оформлении. */
  idempotencyKey: string;
};

/** Параметры освобождения попытки оформления. */
export type SubscriptionCheckoutReleaseInput = SubscriptionCheckoutSubject & {
  /** ID попытки оплаты из состояния оформления. */
  attemptId: string;
};

/** Условия выбранного предложения. */
export interface SubscriptionCheckoutTerms {
  /** Ключ попытки, использованный при чтении условий оформления. */
  idempotencyKey: string;
  /** Срок подписки в месяцах из выбранного предложения. */
  months: number;
  /** Версия выбранного предложения. */
  quoteVersion: string;
  /** Цена из предложения в минимальных единицах валюты. */
  expectedInitialAmountMinor: number;
}

/** Оплата своей подписки. Для автопродления передайте версию принятого согласия из checkoutState(). */
export type SubscriptionPaymentInput = SubscriptionCheckoutTerms & {
  /** ID сохранённого способа оплаты. */
  methodId?: string;
} & (
    | {
        /** Включает автопродление. */
        autoRenewal: true;
        /** Версия согласия, принятого пользователем. */
        consentVersion: string;
      }
    | {
        /** Оформляет подписку без автопродления. */
        autoRenewal?: false;
        consentVersion?: never;
      }
  );

/** Оформление подарка без автопродления. */
export interface SubscriptionGiftInput extends SubscriptionCheckoutTerms {
  /** ID получателя подарка. */
  recipientUserId: UserId;
}

/** Опции обычной оплаты подписки. */
export interface SubscriptionPayOptions extends RequestOptions {
  /** ID сохранённого способа оплаты. */
  methodId?: string;
}

/** Опции привязки карты. */
export interface SubscriptionBindCardOptions extends RequestOptions {
  /** Тип способа оплаты. По умолчанию `PaymentMethodType.BankCard`. */
  type?: PaymentMethodType;
}

/**
 * Подписка и способы оплаты.
 *
 * Доступна как `itd.subscription`.
 */
export class SubscriptionResource extends BaseResource {
  /** Загружает состояние подписки и её цену. */
  status(options: RequestOptions = {}): Promise<Subscription> {
    return this.http.execute(SUBSCRIPTION_STATUS, {
      // Завершающий слэш обязателен.
      path: '/api/v1/subscription/',
      ...options,
    });
  }

  /** Загружает предложения и состояние попытки для себя или получателя подарка. */
  checkoutState(
    input: SubscriptionCheckoutInput,
    options: RequestOptions = {},
  ): Promise<SubscriptionCheckoutState> {
    return this.http.execute(SUBSCRIPTION_CHECKOUT_STATE, {
      path: '/api/v1/subscription/checkout-state',
      query: {
        kind: input.kind,
        recipientUserId: input.recipientUserId,
        idempotencyKey: input.idempotencyKey,
      },
      ...options,
    });
  }

  /** Загружает состояние оплаты по ID платежа. */
  payment(paymentId: string, options: RequestOptions = {}): Promise<SubscriptionPayment> {
    return this.http.execute(SUBSCRIPTION_PAYMENT, {
      path: `/api/v1/subscription/payments/${encodePathSegment(paymentId, 'paymentId')}`,
      ...options,
    });
  }

  /** Загружает состояние подарка по ID. */
  gift(giftId: string, options: RequestOptions = {}): Promise<SubscriptionGift> {
    return this.http.execute(SUBSCRIPTION_GIFT, {
      path: `/api/v1/subscription/gifts/${encodePathSegment(giftId, 'giftId')}`,
      ...options,
    });
  }

  /** Загружает число подаренных пользователем подписок. */
  giftGiver(userId: UserId, options: RequestOptions = {}): Promise<{ giftsGiven: number }> {
    return this.http.execute(SUBSCRIPTION_GIFT_GIVER, {
      path: `/api/v1/subscription/gift-giver/${encodePathSegment(userId, 'userId')}`,
      ...options,
    });
  }

  /** Загружает доступность международной оплаты, предложения и действующий обменный курс. */
  internationalCheckoutCapability(
    options: RequestOptions = {},
  ): Promise<InternationalSubscriptionCapability> {
    return this.http.execute(SUBSCRIPTION_INTERNATIONAL_CAPABILITY, {
      path: '/api/v1/subscription/international-checkouts/capability',
      ...options,
    });
  }

  /** Запускает обычную оплату подписки с выбранным способом оплаты, если он указан. */
  pay({ methodId, ...options }: SubscriptionPayOptions = {}): Promise<unknown> {
    return this.http.execute(SUBSCRIPTION_PAY, {
      path: '/api/v1/subscription/pay',
      ...(methodId !== undefined ? { body: { methodId } } : {}),
      ...options,
    });
  }

  /** Запускает оплату своей подписки по выбранному предложению из {@link checkoutState}. */
  payCheckout(
    input: SubscriptionPaymentInput,
    options: RequestOptions = {},
  ): Promise<SubscriptionPayment> {
    return this.http.execute(SUBSCRIPTION_PAY_CHECKOUT, {
      path: '/api/v1/subscription/pay',
      body: {
        ...input,
        checkoutVersion: SUBSCRIPTION_CHECKOUT_VERSION,
        autoRenewal: input.autoRenewal ?? false,
      },
      ...options,
    });
  }

  /** Запускает оплату подарка по выбранному предложению из {@link checkoutState}. */
  createGift(
    input: SubscriptionGiftInput,
    options: RequestOptions = {},
  ): Promise<SubscriptionGift> {
    return this.http.execute(SUBSCRIPTION_CREATE_GIFT, {
      path: '/api/v1/subscription/gifts',
      body: { ...input, checkoutVersion: SUBSCRIPTION_CHECKOUT_VERSION, autoRenewal: false },
      ...options,
    });
  }

  /** Освобождает ожидающую попытку оплаты, если её состояние допускает это действие. */
  releaseCheckout(
    input: SubscriptionCheckoutReleaseInput,
    options: RequestOptions = {},
  ): Promise<{ released: boolean }> {
    return this.http.execute(SUBSCRIPTION_RELEASE_CHECKOUT, {
      path: '/api/v1/subscription/checkout-release',
      body: input,
      ...options,
    });
  }

  /** Запрашивает данные для перехода к международной оплате. */
  internationalCheckout(
    input: SubscriptionCheckoutInput,
    options: RequestOptions = {},
  ): Promise<InternationalSubscriptionCheckout> {
    return this.http.execute(SUBSCRIPTION_INTERNATIONAL_CHECKOUT, {
      path: '/api/v1/subscription/international-checkouts',
      body: input,
      ...options,
    });
  }

  /** Получает ссылку для продолжения существующей попытки международной оплаты. */
  resumeInternationalCheckout(
    attemptId: string,
    options: RequestOptions = {},
  ): Promise<{ checkoutUrl: string }> {
    return this.http.execute(SUBSCRIPTION_RESUME_INTERNATIONAL_CHECKOUT, {
      path: '/api/v1/subscription/international-checkouts/resume',
      body: { attemptId },
      ...options,
    });
  }

  /** Освобождает попытку международной оплаты. */
  releaseInternationalCheckout(
    input: SubscriptionCheckoutReleaseInput,
    options: RequestOptions = {},
  ): Promise<{ released: boolean }> {
    return this.http.execute(SUBSCRIPTION_RELEASE_INTERNATIONAL_CHECKOUT, {
      path: '/api/v1/subscription/international-checkouts/release',
      body: input,
      ...options,
    });
  }

  /** Включает или отключает автопродление. */
  setAutoRenewal(enabled: boolean, options: RequestOptions = {}): Promise<unknown> {
    return this.http.execute(SUBSCRIPTION_SET_AUTO_RENEWAL, {
      path: '/api/v1/subscription/auto-renewal',
      body: { enabled },
      ...options,
    });
  }

  /** Запускает привязку карты. */
  bindCard({
    type = PaymentMethodType.BankCard,
    ...options
  }: SubscriptionBindCardOptions = {}): Promise<unknown> {
    return this.http.execute(SUBSCRIPTION_BIND_CARD, {
      path: '/api/v1/subscription/bind-card',
      body: { type },
      ...options,
    });
  }

  /** Загружает список способов оплаты. Пустой массив, если карт нет. */
  methods(options: RequestOptions = {}): Promise<PaymentMethod[]> {
    return this.http.execute(SUBSCRIPTION_METHODS, {
      path: '/api/v1/subscription/methods',
      ...options,
    });
  }

  /** Делает способ оплаты основным. */
  setDefaultMethod(methodId: string, options: RequestOptions = {}): Promise<unknown> {
    return this.http.execute(SUBSCRIPTION_SET_DEFAULT_METHOD, {
      path: `/api/v1/subscription/methods/${encodePathSegment(methodId, 'methodId')}/default`,
      ...options,
    });
  }

  /** Удаляет способ оплаты. */
  removeMethod(methodId: string, options: RequestOptions = {}): Promise<void> {
    return this.voidOperation(SUBSCRIPTION_REMOVE_METHOD, {
      path: `/api/v1/subscription/methods/${encodePathSegment(methodId, 'methodId')}`,
      ...options,
    });
  }
}
