import { describe, expect, it } from 'vitest';
import { ItdClient } from '../src/client.js';
import { DEFAULT_STATUS_BASE_URL } from '../src/core/config.js';
import { utcStampToIso } from '../src/core/time.js';
import { statusDays, toDate } from '../src/types/models.js';
import { createMockFetch, json } from './helpers/mock-fetch.js';

/** Урезанный ответ `статус.итд.com` — с пропусками в истории, как отдаёт сервер. */
const STATUS_RESPONSE = {
  overall_status: 'operational',
  updated_at: '2026-07-23T23:15:08.370Z',
  services: [
    {
      id: 'auth',
      name: 'Auth Service',
      current_status: 'operational',
      current_message: 'No downtime',
      latency_ms: 165,
      last_checked: '2026-07-23 23:14:25',
      uptime_90d: 97.92,
      days: {
        '0': { type: 'operational', date_key: '2026-07-23', uptime: 100, lines: [] },
        '1': { type: 'operational', date_key: '2026-07-22', uptime: 100, lines: [] },
        '3': {
          type: 'downtime',
          date_key: '2026-07-20',
          uptime: 99.92,
          lines: [{ t: 'down', text: 'недоступен 1 мин (02:00–02:01)' }],
        },
        '89': { type: 'operational', date_key: '2026-04-25', uptime: 100, lines: [] },
      },
    },
    {
      id: 'main',
      name: 'Main Service',
      current_status: 'degraded',
      current_message: 'No downtime',
      latency_ms: 163,
      last_checked: '2026-07-23 23:14:25',
      uptime_90d: 98.19,
      days: {},
    },
  ],
};

function makeClient(body: unknown = STATUS_RESPONSE) {
  const mock = createMockFetch(() => json(body));
  const itd = new ItdClient({
    baseUrl: 'https://itd.test',
    fetch: mock.fetch,
    auth: 'token-123',
    retry: false,
    rateLimit: false,
    mode: 'server',
  });

  return { itd, mock };
}

describe('utcStampToIso', () => {
  it('приводит отметку без зоны к ISO в UTC', () => {
    expect(utcStampToIso('2026-07-23 23:14:25')).toBe('2026-07-23T23:14:25Z');
    expect(utcStampToIso('2026-07-23 23:14:25.500')).toBe('2026-07-23T23:14:25.500Z');
  });

  it('не трогает строки другого вида', () => {
    expect(utcStampToIso('2026-07-23T23:14:25.370Z')).toBe('2026-07-23T23:14:25.370Z');
    expect(utcStampToIso('вчера')).toBe('вчера');
    expect(utcStampToIso('')).toBe('');
  });

  it('не трогает несуществующую дату', () => {
    expect(utcStampToIso('2026-13-45 99:99:99')).toBe('2026-13-45 99:99:99');
  });
});

describe('itd.platform.status()', () => {
  it('идёт на хост статуса без авторизации', async () => {
    const { itd, mock } = makeClient();

    await itd.platform.status();

    expect(mock.calls[0]?.url).toBe(`${DEFAULT_STATUS_BASE_URL}/api/status`);
    expect(mock.calls[0]?.headers.has('authorization')).toBe(false);
  });

  it('приводит last_checked к ISO', async () => {
    const { itd } = makeClient();

    const status = await itd.platform.status();

    expect(status.services.map((service) => service.last_checked)).toEqual([
      '2026-07-23T23:14:25Z',
      '2026-07-23T23:14:25Z',
    ]);
    expect(toDate(status.services[0]?.last_checked ?? null)?.toISOString()).toBe(
      '2026-07-23T23:14:25.000Z',
    );
  });

  it('остальные поля отдаёт как прислал сервер', async () => {
    const { itd } = makeClient();

    const status = await itd.platform.status();

    expect(status.overall_status).toBe('operational');
    expect(status.updated_at).toBe('2026-07-23T23:15:08.370Z');
    expect(status.services[0]?.days['3']?.lines).toEqual([
      { t: 'down', text: 'недоступен 1 мин (02:00–02:01)' },
    ]);
    expect(status.services[0]?.days['2']).toBeUndefined();
  });

  it('переживает ответ неожиданной формы', async () => {
    const { itd } = makeClient({ overall_status: 'operational' });

    await expect(itd.platform.status()).resolves.toEqual({ overall_status: 'operational' });
  });
});

describe('statusDays', () => {
  it('разворачивает историю в массив на 90 суток с null на пропусках', async () => {
    const { itd } = makeClient();

    const status = await itd.platform.status();
    const [auth, main] = status.services;
    if (!auth || !main) throw new Error('в ответе нет сервисов');

    const days = statusDays(auth);

    expect(days).toHaveLength(90);
    expect(days[0]?.date_key).toBe('2026-07-23');
    expect(days[2]).toBeNull();
    expect(days[89]?.date_key).toBe('2026-04-25');
    expect(days.filter((day) => day === null)).toHaveLength(86);

    expect(statusDays(main).every((day) => day === null)).toBe(true);
  });
});
