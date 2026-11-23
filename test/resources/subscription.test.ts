import { expect, it } from 'vitest';
import { SubscriptionCheckoutKind, SubscriptionCheckoutStatus } from '../../src/index.js';
import { createRestClient } from '../../src/rest.js';
import { createMockFetch, json } from '../helpers/mock-fetch.js';

const offer = {
  months: 3,
  initialAmountMinor: 49900,
  currency: 'RUB',
  quoteVersion: 'nuksta-rub-v2',
  renewalMonths: 1,
  renewalAmountMinor: 19900,
  renewalCurrency: 'RUB',
};
const terms = {
  idempotencyKey: 'checkout-key',
  months: offer.months,
  quoteVersion: offer.quoteVersion,
  expectedInitialAmountMinor: offer.initialAmountMinor,
};
const target = {
  kind: SubscriptionCheckoutKind.Gift,
  recipientUserId: 'recipient',
} as const;
const gift = {
  giftId: 'gift/1',
  recipientUserId: target.recipientUserId,
  status: SubscriptionCheckoutStatus.Pending,
  quote: { ...offer, provider: 'yookassa', consentVersion: null, autoRenewal: false },
};
const payment = { paymentId: 'payment/1', status: gift.status, quote: gift.quote, paid: false };
const baseUrl = 'https://itd.test';
const basePath = '/api/v1/subscription';

function makeClient(responses: Response[]) {
  const mock = createMockFetch(responses);
  const itd = createRestClient({ baseUrl, auth: 'test-token', fetch: mock.fetch, retry: false });
  return { itd, mock };
}

it('читает состояние оформления и проверяет платёж и подарок по разным маршрутам', async () => {
  const state = {
    kind: target.kind,
    subject: target,
    state: SubscriptionCheckoutStatus.Ready,
    offers: [offer],
    quote: null,
    attemptId: null,
    canEditTerms: true,
    canStartNewAttempt: true,
  };
  const capability = { enabled: true, test: false };
  const { itd, mock } = makeClient([
    json(state),
    json(payment),
    json(gift),
    json({ giftsGiven: 5 }),
    json(capability),
  ]);
  try {
    const subscription = itd.subscription;
    expect(
      await subscription.checkoutState({ ...target, idempotencyKey: terms.idempotencyKey }),
    ).toEqual(state);
    expect(await subscription.payment(payment.paymentId)).toEqual(payment);
    expect(await subscription.gift(gift.giftId)).toEqual(gift);
    expect(await subscription.giftGiver('user/1')).toEqual({ giftsGiven: 5 });
    expect(await subscription.internationalCheckoutCapability()).toEqual(capability);

    expect(mock.calls.map(({ url }) => new URL(url).pathname)).toEqual([
      `${basePath}/checkout-state`,
      `${basePath}/payments/payment%2F1`,
      `${basePath}/gifts/gift%2F1`,
      `${basePath}/gift-giver/user%2F1`,
      `${basePath}/international-checkouts/capability`,
    ]);
    expect(Object.fromEntries(new URL(mock.calls[0]?.url ?? baseUrl).searchParams)).toEqual({
      ...target,
      idempotencyKey: terms.idempotencyKey,
    });
    expect(
      mock.calls.every(
        ({ method, headers }) =>
          method === 'GET' && headers.get('authorization') === 'Bearer test-token',
      ),
    ).toBe(true);
  } finally {
    await itd.close();
  }
});

it('оформляет выбранное предложение и управляет попытками оплаты', async () => {
  const international = {
    mode: 'checkout',
    paymentsEnabled: true,
    handoffUrl: 'https://checkout.example',
    termSelection: 'landing',
    handoff: {
      method: 'POST',
      url: 'https://checkout.example',
      fields: { handoffTicket: 'fixture-ticket' },
      expiresAt: '2026-11-23T16:00:00Z',
    },
  };
  const resumed = { checkoutUrl: 'https://checkout.example/resume' };
  const { itd, mock } = makeClient([
    json(payment),
    json(gift),
    json({ released: true }),
    json(international),
    json(resumed),
    json({ released: false }),
  ]);
  const own = { kind: SubscriptionCheckoutKind.Self } as const;
  const renewal = { autoRenewal: true, consentVersion: 'consent', methodId: 'card-1' } as const;
  const recipient = { recipientUserId: target.recipientUserId };
  try {
    const subscription = itd.subscription;
    expect(await subscription.payCheckout({ ...terms, ...renewal })).toEqual(payment);
    expect(await subscription.createGift({ ...terms, ...recipient })).toEqual(gift);
    expect(await subscription.releaseCheckout({ ...own, attemptId: 'attempt-1' })).toEqual({
      released: true,
    });
    expect(
      await subscription.internationalCheckout({ ...target, idempotencyKey: terms.idempotencyKey }),
    ).toEqual(international);
    expect(await subscription.resumeInternationalCheckout('attempt-2')).toEqual(resumed);
    expect(
      await subscription.releaseInternationalCheckout({ ...target, attemptId: 'attempt-2' }),
    ).toEqual({ released: false });

    expect(
      mock.calls.map(({ method, url, body }) => [
        method,
        new URL(url).pathname,
        JSON.parse(body ?? 'null'),
      ]),
    ).toEqual([
      ['POST', `${basePath}/pay`, { ...terms, ...renewal, checkoutVersion: 2 }],
      [
        'POST',
        `${basePath}/gifts`,
        { ...terms, ...recipient, checkoutVersion: 2, autoRenewal: false },
      ],
      ['POST', `${basePath}/checkout-release`, { ...own, attemptId: 'attempt-1' }],
      [
        'POST',
        `${basePath}/international-checkouts`,
        { ...target, idempotencyKey: terms.idempotencyKey },
      ],
      ['POST', `${basePath}/international-checkouts/resume`, { attemptId: 'attempt-2' }],
      [
        'POST',
        `${basePath}/international-checkouts/release`,
        { ...target, attemptId: 'attempt-2' },
      ],
    ]);
  } finally {
    await itd.close();
  }
});

it('передаёт способ оплаты и привязывает карту через существующие методы', async () => {
  const method = { id: 'card/1', cardLast4: '1234', cardBrand: 'mir', canAutoRenew: true };
  const { itd, mock } = makeClient([
    json({ data: [method] }),
    json({}),
    json({}),
    json({}),
    json({}),
  ]);
  try {
    const subscription = itd.subscription;
    expect(await subscription.methods()).toEqual([{ ...method, last4: '1234', brand: 'mir' }]);
    await subscription.pay({ timeout: 500 });
    await subscription.pay({ methodId: method.id, headers: { 'x-test': 'pay' } });
    await subscription.bindCard({ timeout: 500 });
    await subscription.setDefaultMethod(method.id);

    expect(mock.calls[1]?.body).toBeUndefined();
    expect(mock.calls[2]?.body).toBe(JSON.stringify({ methodId: method.id }));
    expect(mock.calls[2]?.headers.get('x-test')).toBe('pay');
    expect(mock.calls[3]?.body).toBe('{"type":"bank_card"}');
    expect(mock.calls[4]).toMatchObject({
      method: 'PUT',
      url: `${baseUrl}${basePath}/methods/card%2F1/default`,
    });
  } finally {
    await itd.close();
  }
});

it('не повторяет создание платежа и подарка после HTTP 503', async () => {
  const mock = createMockFetch(() => json({ error: 'Недоступно' }, { status: 503 }));
  const itd = createRestClient({
    baseUrl,
    auth: 'test-token',
    fetch: mock.fetch,
    retry: { attempts: 2, baseDelay: 0, jitter: 0 },
  });
  try {
    await expect(itd.subscription.payCheckout(terms)).rejects.toMatchObject({ status: 503 });
    await expect(
      itd.subscription.createGift({ ...terms, recipientUserId: target.recipientUserId }),
    ).rejects.toMatchObject({ status: 503 });
    expect(mock.callCount).toBe(2);
  } finally {
    await itd.close();
  }
});
