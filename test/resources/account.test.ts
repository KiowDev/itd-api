import { describe, expect, it } from 'vitest';
import { ItdClient } from '../../src/client.js';
import { ItdConfigError, ItdStateError } from '../../src/core/errors.js';
import { redactBody } from '../../src/core/redact.js';
import { ContactProofMethod } from '../../src/models/account-access.js';
import type { TermsAcceptance } from '../../src/models/legal.js';
import { PhoneVerificationMethod } from '../../src/models/phone-auth.js';
import { createRestClient } from '../../src/rest.js';
import { CaptchaType } from '../../src/types/enums.js';
import { createMockFetch, json } from '../helpers/mock-fetch.js';

function setup(responses: Response[]) {
  const mock = createMockFetch(responses);
  const api = new ItdClient({
    baseUrl: 'https://itd.test',
    auth: 'current-token',
    fetch: mock.fetch,
    mode: 'server',
    retry: false,
    rateLimit: false,
  });
  return { account: api.account, api, mock };
}

describe('согласие с условиями аккаунта', () => {
  it('получает состояние и передаёт согласие с текущим Bearer', async () => {
    const version = '2026-04-03';
    const required = {
      version,
      required: true,
      consent: {
        protocolVersion: 2,
        contextToken: 'consent-token',
        id: 'context',
        issuedAt: 0,
        expiresAt: 60_000,
        bundle: {
          id: 'bundle',
          flow: 'account_terms',
          documents: [
            { scope: 'social', slug: 'terms', version, contentSha256: 'sha256', url: '/terms' },
          ],
          actions: {},
          actionVersion: '1',
          submitLabel: 'Принять',
          text: [{ text: 'Условия' }],
        },
      },
    } satisfies TermsAcceptance;
    const accepted = { version, required: false };
    const { account, mock } = setup([
      json(required),
      new Response(null, { status: 204 }),
      json(accepted),
    ]);

    await expect(account.termsAcceptance()).resolves.toEqual(required);
    await account.acceptTerms(required.consent.contextToken);
    await expect(account.termsAcceptance()).resolves.toEqual(accepted);

    expect(mock.calls.map(({ method }) => method)).toEqual(['GET', 'POST', 'GET']);
    expect(
      mock.calls.every(
        ({ url, headers }) =>
          new URL(url).pathname === '/api/v1/auth/terms-acceptance' &&
          headers.get('authorization') === 'Bearer current-token',
      ),
    ).toBe(true);
    expect(JSON.parse(mock.calls[1]?.body ?? '{}')).toEqual({
      accepted: true,
      contextToken: required.consent.contextToken,
    });
  });
});

describe('способы входа текущего аккаунта', () => {
  it('запрашивает повторную отправку кода на почту через отдельный маршрут', async () => {
    const input = { email: 'user@example.com', flowToken: 'flow' };
    const { account, api, mock } = setup([
      new Response(null, { status: 204 }),
      new Response(null, { status: 204 }),
    ]);

    await api.auth.resendOtp(input);
    await account.email.resendOtp(input);

    expect(mock.calls.map(({ method, url }) => [method, new URL(url).pathname])).toEqual([
      ['POST', '/api/v1/auth/email/resend-otp'],
      ['POST', '/api/v1/auth/email/resend-otp'],
    ]);
    expect(mock.calls.map(({ headers }) => headers.get('authorization'))).toEqual([
      null,
      'Bearer current-token',
    ]);
    expect(mock.calls.map(({ body }) => JSON.parse(body ?? '{}'))).toEqual([input, input]);
  });

  it('получает сведения о доступе к аккаунту с текущим Bearer', async () => {
    const info = { email: null, phone: '+79991234567', hasPassword: false };
    const { account, mock } = setup([json(info)]);

    await expect(account.getInfo()).resolves.toEqual(info);
    expect(mock.calls[0]?.url).toBe('https://itd.test/api/v1/auth/methods');
    expect(mock.calls[0]?.headers.get('authorization')).toBe('Bearer current-token');
  });

  it('отправляет текущий и новый пароль с авторизацией', async () => {
    const { account, mock } = setup([new Response(null, { status: 204 })]);
    const input = { currentPassword: 'old-password', newPassword: 'new-password' };
    await account.password.change(input);
    expect(mock.calls).toHaveLength(1);
    const [call] = mock.calls;
    expect(call?.method).toBe('POST');
    expect(call?.url).toBe('https://itd.test/api/v1/auth/change-password');
    expect(call?.headers.get('authorization')).toBe('Bearer current-token');
    expect(JSON.parse(call?.body ?? '{}')).toEqual(input);
  });

  it('подтверждает смену с текущим Bearer и передаёт код в отдельный запрос', async () => {
    const input = { email: 'new@example.com', otp: '123456', flowToken: 'flow' };
    const { account, api, mock } = setup([
      json({ flowToken: input.flowToken }),
      json({ mode: 'change', changeToken: 'change', proofs: ['email_code'] }),
      json({ sentTo: 'o***@example.com' }),
      json({ success: true }),
    ]);

    expect(await account.email.startChange(input.email)).toBe(input.flowToken);
    const change = await account.email.verifyChange(input);
    expect(change).toEqual({ changeToken: 'change', proofs: [ContactProofMethod.EmailCode] });
    await account.changes.requestProof({
      changeToken: change.changeToken,
      method: ContactProofMethod.EmailCode,
    });
    await account.changes.confirm({ changeToken: change.changeToken, code: '654321' });

    expect(mock.calls.map(({ url }) => new URL(url).pathname)).toEqual([
      '/api/v1/auth/email/change',
      '/api/v1/auth/verify-otp',
      '/api/v1/auth/change/proof',
      '/api/v1/auth/change/confirm',
    ]);
    expect(mock.calls.map(({ headers }) => headers.get('authorization'))).toEqual(
      Array(4).fill('Bearer current-token'),
    );
    expect(JSON.parse(mock.calls[1]?.body ?? '{}')).toEqual(input);
    for (const { headers } of mock.calls) {
      expect(headers.get('X-ITD-Phone-Reverse')).toBeNull();
      expect(headers.get('X-ITD-Flow-Expiry')).toBeNull();
    }
    const confirmation = JSON.parse(mock.calls[3]?.body ?? '{}');
    expect(confirmation).toEqual({ changeToken: 'change', code: '654321' });
    expect(redactBody(confirmation)).toEqual({ changeToken: '[скрыто]', code: '[скрыто]' });
    expect((await api.getSession())?.accessToken).toBe('current-token');
  });

  it('не принимает ответ входа за подтверждение смены и не сохраняет его сессию', async () => {
    const { account, api, mock } = setup([
      json({ mode: 'signin', accessToken: 'unexpected-token' }),
    ]);
    await expect(
      account.phone.verifyChange({ phone: '+79991234567', flowToken: 'flow', otp: '1234' }),
    ).rejects.toThrow(ItdConfigError);
    expect(mock.calls[0]?.headers.get('X-ITD-Phone-Reverse')).toBe('1');
    expect(mock.calls[0]?.headers.get('X-ITD-Flow-Expiry')).toBe('1');
    expect(mock.calls[0]?.headers.get('X-ITD-Reverse-Attempts')).toBeNull();
    expect((await api.getSession())?.accessToken).toBe('current-token');
  });

  it.each(['attach', 'startChange'] as const)(
    '%s не отправляет запрос, если сессия сменилась во время получения капчи',
    async (method) => {
      const mock = createMockFetch([]);
      let resolveProof!: (token: string) => void;
      const proof = new Promise<string>((resolve) => {
        resolveProof = resolve;
      });
      const api = new ItdClient({
        baseUrl: 'https://itd.test',
        auth: 'account-a',
        fetch: mock.fetch,
        captcha: { type: CaptchaType.Itd, getToken: () => proof },
      });
      await api.getSession();
      const pending = api.account.phone[method]({ phone: '+79991234567' });
      const rejected = expect(pending).rejects.toBeInstanceOf(ItdStateError);
      await api.setSession({ accessToken: 'account-b' });
      resolveProof('proof');
      await rejected;
      expect(mock.callCount).toBe(0);
    },
  );

  it('поддерживает привязку номера исходящим звонком с авторизацией', async () => {
    const phone = '+79991234567';
    const { account, mock } = setup([
      json({
        flowToken: 'flow',
        delivery: { type: 'missed_call', codeLength: 4 },
        reverseOnly: true,
        retryIn: 60,
      }),
      json({ success: true }),
    ]);
    const flow = await account.phone.attach({
      phone,
      captcha: { type: CaptchaType.Itd, token: 'proof' },
      method: PhoneVerificationMethod.Reverse,
    });
    expect(flow).toMatchObject({ flowToken: 'flow', channel: 'missed_call', reverseOnly: true });
    expect(mock.calls[0]?.headers.get('X-ITD-Phone-Method')).toBe('reverse');
    expect(JSON.parse(mock.calls[0]?.body ?? '{}')).toEqual({
      phone,
      captcha: { provider: CaptchaType.Itd, token: 'proof' },
    });
    await expect(
      account.phone.reverseAttachComplete({ phone, flowToken: flow.flowToken }),
    ).resolves.toEqual({ success: true });
    expect(mock.calls[1]?.headers.get('authorization')).toBe('Bearer current-token');
    expect(mock.calls[1]?.headers.get('X-ITD-Phone-Reverse')).toBe('1');
    expect(mock.calls[1]?.headers.get('X-ITD-Reverse-Attempts')).toBe('1');
    expect(mock.calls[1]?.headers.get('X-ITD-Flow-Expiry')).toBe('1');
  });

  it('запрашивает исходящий звонок при начале смены номера', async () => {
    const phone = '+79991234567';
    const { account, mock } = setup([json({ flowToken: 'flow', reverseOnly: true })]);
    await account.phone.startChange(
      { phone, method: PhoneVerificationMethod.Reverse },
      { headers: { 'X-Test': 'test' } },
    );
    const [call] = mock.calls;
    expect(call?.url).toBe('https://itd.test/api/v1/auth/phone/change');
    expect(call?.headers.get('X-ITD-Phone-Method')).toBe('reverse');
    expect(call?.headers.get('X-ITD-Flow-Expiry')).toBe('1');
    expect(call?.headers.get('X-Test')).toBe('test');
    expect(JSON.parse(call?.body ?? '{}')).toEqual({ phone });
  });

  it('извлекает отложенную заявку и отменяет её по закодированному ID', async () => {
    const request = {
      id: 'req/1',
      kind: 'phone',
      newIdentifier: '+79991234567',
      appliesAt: '2026-11-25T12:00:00Z',
    };
    const { account, mock } = setup([
      json({ requests: [request] }),
      new Response(null, { status: 204 }),
    ]);
    expect(await account.changes.pending()).toEqual([request]);
    await account.changes.cancelPending(request.id);
    expect(mock.calls[1]?.method).toBe('DELETE');
    expect(mock.calls[1]?.url).toBe('https://itd.test/api/v1/auth/change/pending/req%2F1');
  });

  it('не отправляет отмену заявки с сегментом родительского пути', () => {
    const { account, mock } = setup([]);
    expect(() => account.changes.cancelPending('..')).toThrow(ItdConfigError);
    expect(mock.callCount).toBe(0);
  });
});

it('позволяет деактивировать и восстановить аккаунт через REST-клиент', async () => {
  const mock = createMockFetch([
    new Response(null, { status: 204 }),
    new Response(null, { status: 204 }),
  ]);
  const api = createRestClient({
    baseUrl: 'https://itd.test',
    auth: 'current-token',
    fetch: mock.fetch,
    retry: false,
    rateLimit: false,
  });
  await api.account.deactivate();
  await api.account.restore();
  expect(mock.calls.map(({ method, url }) => [method, new URL(url).pathname])).toEqual([
    ['DELETE', '/api/users/me'],
    ['POST', '/api/users/me/restore'],
  ]);
});
