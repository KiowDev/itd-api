import { describe, expect, it } from 'vitest';
import { ItdClient } from '../src/client.js';
import { createMockFetch, json } from './helpers/mock-fetch.js';

const VERSION_RESPONSE = {
  android: {
    minVersion: '1.0.0',
    latestVersion: '1.0.13',
    updateUrl: 'https://play.google.com/store/apps/details?id=com.itd.app',
  },
  ios: {
    minVersion: '1.0.0',
    latestVersion: '1.0.13',
    updateUrl: 'https://apps.apple.com/us/app/%D0%B8%D1%82%D0%B4/id6759969018',
  },
};

function makeClient(body: unknown = VERSION_RESPONSE) {
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

describe('itd.platform.version()', () => {
  it('загружает версии клиентских приложений', async () => {
    const { itd, mock } = makeClient();

    const versions = await itd.platform.version();

    expect(versions).toEqual(VERSION_RESPONSE);
    expect(versions.ios.updateUrl).toBe(VERSION_RESPONSE.ios.updateUrl);
    expect(mock.calls[0]?.method).toBe('GET');
    expect(mock.calls[0]?.url).toBe('https://itd.test/api/platform/version');
    expect(mock.calls[0]?.body).toBeUndefined();
  });

  it('не добавляет авторизацию', async () => {
    const { itd, mock } = makeClient();

    await itd.platform.version();

    expect(mock.calls[0]?.headers.has('authorization')).toBe(false);
  });
});
