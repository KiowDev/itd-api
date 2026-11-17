import { describe, expect, it, vi } from 'vitest';
import { ItdClient } from '../../src/client.js';
import { ItdConfigError } from '../../src/core/errors.js';
import { RetrySafety } from '../../src/core/operation.js';
import { redactBody } from '../../src/core/redact.js';
import { operationBucket, operationRetrySafety } from '../../src/domain/operations.js';
import {
  AuthVerificationMode,
  type PhoneConsent,
  PhoneDeliveryChannel,
  PhoneLoginStep,
  PhoneReverseState,
  PhoneVerificationMethod,
} from '../../src/models/phone-auth.js';
import type { ItdClientOptions } from '../../src/options.js';
import { CaptchaType } from '../../src/types/enums.js';
import { createMockFetch, json, type MockHandler } from '../helpers/mock-fetch.js';

const flow = { phone: '+79991234567', flowToken: 'a'.repeat(32) };
const delivery = { delivery: { type: 'missed_call', codeLength: 4 }, next: null, retryIn: 60 };
const consent = (): PhoneConsent => ({
  protocolVersion: 2,
  contextToken: 'consent-token',
  id: 'context',
  issuedAt: Date.now(),
  expiresAt: Date.now() + 60000,
  bundle: {
    id: 'bundle',
    flow: 'phone_entry',
    documents: [],
    actions: {},
    actionVersion: '1',
    submitLabel: 'Продолжить',
    text: [{ text: 'Условия' }],
  },
});

function makeClient(handler: MockHandler | Response[], options: ItdClientOptions = {}) {
  const mock = createMockFetch(handler);
  const api = new ItdClient({
    baseUrl: 'https://itd.test',
    fetch: mock.fetch,
    auth: 'old-token',
    autoRefresh: false,
    retry: false,
    rateLimit: false,
    mode: 'server',
    ...options,
  });
  return { api, mock };
}

describe('телефонный вход', () => {
  it('читает конфигурацию и согласие без Bearer и не меняет сессию', async () => {
    const config = {
      regions: [{ region: 'TM', callingCode: '993', example: '66123456' }],
      defaultRegion: 'RU',
    };
    const legal = consent();
    const { api, mock } = makeClient([json(config), json(legal)]);
    await expect(api.auth.phone.config()).resolves.toEqual(config);
    await expect(api.auth.phone.consent()).resolves.toEqual(legal);
    expect(mock.calls.map((c) => c.url)).toEqual([
      'https://itd.test/api/v1/auth/phone/config',
      'https://itd.test/api/v1/auth/consent?flow=phone_entry',
    ]);
    expect(mock.calls.every((c) => c.headers.get('authorization') === null)).toBe(true);
    expect(mock.calls.every((c) => c.headers.get('X-ITD-Phone-Reverse') === null)).toBe(true);
    expect((await api.getSession())?.accessToken).toBe('old-token');
  });

  it('передаёт доказательство капчи объектом и только квитанцию согласия', async () => {
    const { api, mock } = makeClient([json({ ...delivery, flowToken: flow.flowToken })]);
    const result = await api.auth.phone.start(
      {
        phone: flow.phone,
        consent: consent(),
        captcha: { type: CaptchaType.Itd, token: 'proof' },
        method: PhoneVerificationMethod.Reverse,
      },
      { headers: { 'X-Test': 'test' } },
    );
    expect(JSON.parse(mock.calls[0]?.body ?? '{}')).toEqual({
      phone: flow.phone,
      captcha: { provider: CaptchaType.Itd, token: 'proof' },
      legal: { protocolVersion: 2, contextToken: 'consent-token' },
    });
    expect(mock.calls[0]?.headers.get('X-ITD-Phone-Method')).toBe(PhoneVerificationMethod.Reverse);
    expect(mock.calls[0]?.headers.get('X-ITD-Phone-Reverse')).toBe('1');
    expect(mock.calls[0]?.headers.get('X-Test')).toBe('test');
    expect(result).toEqual({
      flowToken: flow.flowToken,
      channel: PhoneDeliveryChannel.MissedCall,
      codeLength: 4,
      retryIn: 60,
      nextChannel: null,
    });
    expect((await api.getSession())?.accessToken).toBe('old-token');
  });

  it('использует источник капчи с провайдером сервера и не теряет его имя', async () => {
    const getToken = vi.fn().mockResolvedValue('proof');
    const { api, mock } = makeClient(
      [
        json({ provider: CaptchaType.Itd, field: 'customField' }),
        json({ ...delivery, flowToken: flow.flowToken }),
      ],
      { captcha: { getToken } },
    );
    await api.auth.phone.start({ phone: flow.phone, consent: consent() });
    expect(getToken).toHaveBeenCalledWith(CaptchaType.Itd, { logger: undefined });
    expect(JSON.parse(mock.calls[1]?.body ?? '{}').captcha).toEqual({
      provider: CaptchaType.Itd,
      token: 'proof',
    });
  });

  it('передаёт проверку срока согласия серверу', async () => {
    const { api, mock } = makeClient([
      json({ error: { code: 'LEGAL_CONTEXT_EXPIRED', message: 'Expired' } }, { status: 409 }),
    ]);
    await expect(
      api.auth.phone.start({ phone: flow.phone, consent: { ...consent(), expiresAt: 0 } }),
    ).rejects.toMatchObject({ code: 'LEGAL_CONTEXT_EXPIRED' });
    expect(mock.callCount).toBe(1);
  });

  it('принимает новый провайдер капчи без имени поля запроса', async () => {
    const getToken = vi.fn().mockResolvedValue('proof');
    const { api, mock } = makeClient([json({ ...delivery, flowToken: flow.flowToken })], {
      captcha: { type: 'new-provider', getToken },
    });
    await api.auth.phone.start({ phone: flow.phone, consent: consent() });
    expect(getToken).toHaveBeenCalledWith('new-provider', { logger: undefined });
    expect(JSON.parse(mock.calls[0]?.body ?? '{}').captcha).toEqual({
      provider: 'new-provider',
      token: 'proof',
    });
  });

  it('сохраняет refresh cookie текущей сессии при запуске подтверждения', async () => {
    const { api, mock } = makeClient(
      [json({ ...delivery, flowToken: flow.flowToken }), json({ ok: true })],
      { auth: { accessToken: 'old-token', refreshToken: 'old-refresh' } },
    );
    await api.auth.phone.start({ phone: flow.phone, consent: consent() });
    await api.request({ method: 'GET', path: '/api/v1/auth/test' });
    expect(mock.calls[1]?.headers.get('cookie')).toContain('refresh_token=old-refresh');
    expect((await api.getSession())?.accessToken).toBe('old-token');
  });

  it('передаёт версию протокола, полученную от сервера', async () => {
    const legal = { ...consent(), protocolVersion: 3 };
    const { api, mock } = makeClient([
      json(legal),
      json({ ...delivery, flowToken: flow.flowToken }),
    ]);
    const context = await api.auth.phone.consent();
    await api.auth.phone.start({ phone: flow.phone, consent: context });
    expect(JSON.parse(mock.calls[1]?.body ?? '{}').legal).toEqual({
      protocolVersion: 3,
      contextToken: legal.contextToken,
    });
  });

  it('принимает предоставленный вызывающим контекст с другой версией', async () => {
    const legal = { ...consent(), protocolVersion: 4, contextToken: 'custom-context' };
    const { api, mock } = makeClient([json({ ...delivery, flowToken: flow.flowToken })]);
    await api.auth.phone.start({ phone: flow.phone, consent: legal });
    expect(JSON.parse(mock.calls[0]?.body ?? '{}').legal).toEqual({
      protocolVersion: 4,
      contextToken: 'custom-context',
    });
  });

  it('не меняет access token, если после кода нужен пароль', async () => {
    const next = {
      mode: AuthVerificationMode.SignIn,
      step: PhoneLoginStep.Password,
      flowToken: 'b'.repeat(32),
    };
    const { api, mock } = makeClient([json(next)]);
    await expect(api.auth.phone.verify({ ...flow, otp: '1234' })).resolves.toEqual({
      step: next.step,
      flowToken: next.flowToken,
    });
    expect(JSON.parse(mock.calls[0]?.body ?? '{}')).toEqual({ ...flow, otp: '1234' });
    expect((await api.getSession())?.accessToken).toBe('old-token');
  });

  it('сохраняет access token и refresh cookie завершённого входа', async () => {
    const { api, mock } = makeClient([
      json(
        { accessToken: 'phone-token' },
        {
          headers: { 'set-cookie': 'refresh_token=phone-refresh; Path=/api/v1/auth; HttpOnly' },
        },
      ),
      json({ ok: true }),
    ]);
    await api.auth.phone.verify({ ...flow, otp: '1234' });
    expect((await api.getSession())?.accessToken).toBe('phone-token');
    await api.request({ method: 'GET', path: '/api/v1/auth/test' });
    expect(mock.calls[1]?.headers.get('authorization')).toBe('Bearer phone-token');
    expect(mock.calls[1]?.headers.get('cookie')).toContain('refresh_token=phone-refresh');
  });

  it.each([
    { mode: AuthVerificationMode.Change, changeToken: 'change', proofs: [] },
    { mode: AuthVerificationMode.Change, accessToken: 'unexpected-token' },
    { mode: AuthVerificationMode.Change, step: PhoneLoginStep.Password, flowToken: flow.flowToken },
    { mode: 'unknown', accessToken: 'unexpected-token' },
  ])('не считает ответ другого режима завершением входа', async (body) => {
    const { api } = makeClient([json(body)]);
    await expect(api.auth.phone.verify({ ...flow, otp: '1234' })).rejects.toThrow(ItdConfigError);
    expect((await api.getSession())?.accessToken).toBe('old-token');
  });

  it('не восстанавливает старый вход после смены владельца сессии', async () => {
    let respond!: (response: Response) => void;
    let notify!: () => void;
    const sent = new Promise<void>((resolve) => {
      notify = resolve;
    });
    const { api } = makeClient(
      () =>
        new Promise((resolve) => {
          respond = resolve;
          notify();
        }),
    );
    const pending = api.auth.phone.verify({ ...flow, otp: '1234' });
    await sent;
    await api.setSession({ accessToken: 'changed-token' });
    respond(json({ accessToken: 'stale-token' }));
    await pending;
    expect((await api.getSession())?.accessToken).toBe('changed-token');
  });

  it.each(['password', 'resetPassword'] as const)(
    '%s завершает телефонную сессию',
    async (method) => {
      const { api, mock } = makeClient([json({ accessToken: 'phone-token' })]);
      if (method === 'password') await api.auth.phone.password({ ...flow, password: 'secret' });
      else await api.auth.phone.resetPassword({ ...flow, newPassword: 'new-secret' });
      expect((await api.getSession())?.accessToken).toBe('phone-token');
      expect(mock.calls[0]?.headers.get('authorization')).toBeNull();
    },
  );

  it('повторная доставка возвращает новый канал и длину кода', async () => {
    const { api } = makeClient([
      json({ channel: PhoneDeliveryChannel.Sms, codeLength: 6, retryIn: 90, next: 'missed_call' }),
    ]);
    await expect(api.auth.phone.resend(flow)).resolves.toEqual({
      channel: PhoneDeliveryChannel.Sms,
      codeLength: 6,
      retryIn: 90,
      nextChannel: PhoneDeliveryChannel.MissedCall,
    });
  });

  it('сохраняет серверные ошибки согласия без повторного старта', async () => {
    const { api, mock } = makeClient([
      json({ error: { code: 'LEGAL_DOCUMENTS_UPDATED', message: 'Updated' } }, { status: 409 }),
    ]);
    await expect(
      api.auth.phone.start({ phone: flow.phone, consent: consent() }),
    ).rejects.toMatchObject({ code: 'LEGAL_DOCUMENTS_UPDATED' });
    expect(mock.callCount).toBe(1);
  });

  it('использует POST и специальные заголовки для обратного звонка', async () => {
    const status = {
      state: PhoneReverseState.Waiting,
      expiresIn: 90,
      phone: '+79990000000',
      attemptsLeft: 2,
    };
    const { api, mock } = makeClient([
      json({ available: true, availableIn: 0 }),
      json(status),
      json(status),
      json({ step: PhoneLoginStep.Password, flowToken: flow.flowToken }),
    ]);
    await api.auth.phone.reverseOptions(flow);
    await api.auth.phone.reverseStart(flow);
    await api.auth.phone.reverseStatus(flow);
    await api.auth.phone.reverseComplete(flow);
    expect(
      mock.calls.every(
        (c) => c.method === 'POST' && c.headers.get('X-ITD-Reverse-Attempts') === '1',
      ),
    ).toBe(true);
    expect(mock.calls.every((c) => c.headers.get('X-ITD-Phone-Reverse') === '1')).toBe(true);
    expect(mock.calls.every((c) => c.headers.get('authorization') === null)).toBe(true);
    expect(mock.calls.map((c) => JSON.parse(c.body ?? '{}'))).toEqual([flow, flow, flow, flow]);
    expect((await api.getSession())?.accessToken).toBe('old-token');
  });

  it('завершение обратного звонка сохраняет токен', async () => {
    const { api } = makeClient([json({ accessToken: 'reverse-token' })]);
    await api.auth.phone.reverseComplete(flow);
    expect((await api.getSession())?.accessToken).toBe('reverse-token');
  });

  it.each([{ ...delivery }, { ...delivery, flowToken: '' }, { ...delivery, flowToken: null }])(
    'требует секрет для продолжения входа',
    async (body) => {
      const { api } = makeClient([json(body)]);
      await expect(api.auth.phone.start({ phone: flow.phone, consent: consent() })).rejects.toThrow(
        ItdConfigError,
      );
      expect((await api.getSession())?.accessToken).toBe('old-token');
    },
  );

  it('сохраняет новые каналы и параметры доставки без проверки диапазонов UI', async () => {
    const { api } = makeClient([
      json({
        delivery: { type: 'new_channel', codeLength: 8 },
        retryIn: 120,
        flowToken: 'new-format-token',
      }),
    ]);
    await expect(
      api.auth.phone.start({ phone: flow.phone, consent: consent() }),
    ).resolves.toMatchObject({
      channel: 'new_channel',
      codeLength: 8,
      retryIn: 120,
      flowToken: 'new-format-token',
    });
  });

  it('возвращает новые состояния звонка и дополнительные поля сервера', async () => {
    const status = {
      state: 'new_state',
      expiresIn: 500,
      phone: null,
      attemptsLeft: 5,
      extra: true,
    };
    const { api } = makeClient([json(status)]);
    await expect(api.auth.phone.reverseStatus(flow)).resolves.toEqual(status);
  });

  it('использует общий auth-бакет и не повторяет доставку автоматически', () => {
    expect(operationBucket('auth.phone.start')).toBe('auth');
    expect(operationBucket('auth.phone.reverseStatus')).toBe('auth');
    expect(operationRetrySafety('auth.phone.start')).toBe(RetrySafety.Unsafe);
    expect(operationRetrySafety('auth.phone.reverseStatus')).toBe(RetrySafety.Safe);
  });

  it('скрывает контекст согласия и вложенный токен капчи', () => {
    expect(
      redactBody({
        captcha: { provider: CaptchaType.Itd, token: 'secret' },
        legal: { protocolVersion: 2, contextToken: 'secret' },
      }),
    ).toEqual({
      captcha: { provider: CaptchaType.Itd, token: '[скрыто]' },
      legal: { protocolVersion: 2, contextToken: '[скрыто]' },
    });
  });
});
