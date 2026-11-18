import { describe, expect, it } from 'vitest';
import { ItdClient } from '../../src/client.js';
import { ItdConfigError } from '../../src/core/errors.js';
import { redactBody } from '../../src/core/redact.js';
import { ContactProofMethod } from '../../src/models/account-access.js';
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

describe('способы входа текущего аккаунта', () => {
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
    const confirmation = JSON.parse(mock.calls[3]?.body ?? '{}');
    expect(confirmation).toEqual({ changeToken: 'change', code: '654321' });
    expect(redactBody(confirmation)).toEqual({ changeToken: '[скрыто]', code: '[скрыто]' });
    expect((await api.getSession())?.accessToken).toBe('current-token');
  });

  it('не принимает ответ входа за подтверждение смены и не сохраняет его сессию', async () => {
    const { account, api } = setup([json({ mode: 'signin', accessToken: 'unexpected-token' })]);
    await expect(
      account.phone.verifyChange({ phone: '+79991234567', flowToken: 'flow', otp: '1234' }),
    ).rejects.toThrow(ItdConfigError);
    expect((await api.getSession())?.accessToken).toBe('current-token');
  });

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
    });
    expect(flow).toMatchObject({ flowToken: 'flow', channel: 'missed_call', reverseOnly: true });
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
