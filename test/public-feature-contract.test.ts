import { readFile } from 'node:fs/promises';
import { ItdAccounts, ItdClient } from 'itd-api';
import type { EventTransport, EventTransportContext, EventTransportFrame } from 'itd-api/events';
import { ItdRestClient } from 'itd-api/rest';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import {
  type ContractProbeApi,
  createContractProbeAccountFeature,
  createContractProbeFeature,
} from './fixtures/public-feature.js';

interface RecordedRequest {
  readonly url: string;
  readonly headers: Headers;
  readonly body: BodyInit | null | undefined;
}

function createContractFetch(records: RecordedRequest[]): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    records.push({
      url,
      headers: new Headers(init?.headers),
      body: init?.body,
    });
    const data = url.endsWith('/uploads')
      ? { uploaded: true }
      : { id: decodeURIComponent(url.slice(url.lastIndexOf('/') + 1)) };
    return new Response(JSON.stringify({ data }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
}

class InjectedTransport implements EventTransport {
  readonly name = 'injected-contract-transport';
  context: EventTransportContext | undefined;
  connections = 0;
  stops = 0;

  connect(context: EventTransportContext): Promise<void> {
    this.context = context;
    this.connections += 1;
    context.onOpen();
    return new Promise((resolve) => {
      const stop = () => {
        this.stops += 1;
        resolve();
      };
      if (context.signal.aborted) stop();
      else context.signal.addEventListener('abort', stop, { once: true });
    });
  }

  emit(frame: EventTransportFrame): void {
    this.context?.onEvent(frame);
  }
}

type AccountWithContractProbe = ReturnType<ItdAccounts['addAccount']> & {
  readonly contractProbe: ContractProbeApi;
};

describe('публичный контракт подключаемого модуля', () => {
  it('не импортирует внутренние файлы библиотеки', async () => {
    const source = await readFile(new URL('./fixtures/public-feature.ts', import.meta.url), 'utf8');
    const imports = [...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)]
      .map((match) => match[1])
      .sort();

    expect(imports).toEqual(['itd-api', 'itd-api/events', 'itd-api/rest']);
  });

  it('работает в полном клиенте с переопределённым сервисом, авторизацией, файлом и событийным каналом', async () => {
    const requests: RecordedRequest[] = [];
    const transport = new InjectedTransport();
    const client = new ItdClient({
      auth: 'full-token',
      fetch: createContractFetch(requests),
      mode: 'server',
      retry: false,
      rateLimit: false,
      services: { 'contract-probe-api': 'https://contract-override.test/root' },
    });
    const probe = client.install(createContractProbeFeature({ transport }));
    expectTypeOf(probe).toEqualTypeOf<ContractProbeApi>();

    await expect(probe.read('запись 1')).resolves.toEqual({ id: 'запись 1' });
    await expect(
      probe.upload({
        file: new Uint8Array([1, 2, 3]),
        filename: 'payload.bin',
        contentType: 'application/octet-stream',
      }),
    ).resolves.toEqual({ uploaded: true });

    expect(probe.serviceBaseUrl()).toBe('https://contract-override.test/root');
    expect(requests.map(({ url }) => url)).toEqual([
      'https://contract-override.test/root/records/%D0%B7%D0%B0%D0%BF%D0%B8%D1%81%D1%8C%201',
      'https://contract-override.test/root/uploads',
    ]);
    expect(requests[0]?.headers.get('authorization')).toBe('Bearer full-token');
    expect(requests[0]?.headers.get('x-contract-feature')).toBe('enabled');
    expect(requests[1]?.headers.get('content-type')).toBe('application/octet-stream');
    expect(Array.from(requests[1]?.body as Uint8Array)).toEqual([1, 2, 3]);

    const received: string[] = [];
    probe.events.onEvent((event) => {
      received.push(event.id);
    });
    await probe.events.connect();
    transport.emit({ name: 'contract', data: { id: 'event-1', value: 42 } });
    await vi.waitFor(() => expect(received).toEqual(['event-1']));

    expect(transport.context?.baseUrl).toBe('https://contract-override.test/root');
    await expect(transport.context?.getToken()).resolves.toBe('full-token');
    expect(
      (await transport.context?.baseHeaders('https://contract-override.test/root/events'))?.get(
        'x-contract-feature',
      ),
    ).toBe('enabled');

    await client.close();
    expect(transport.stops).toBe(1);
    await client.dispose();
  });

  it('сохраняет локальный rps при установке в минимальный REST-клиент', async () => {
    vi.useFakeTimers();
    try {
      const requests: RecordedRequest[] = [];
      const client = new ItdRestClient({
        auth: 'rest-token',
        fetch: createContractFetch(requests),
        mode: 'server',
        retry: false,
        rateLimit: { concurrency: 4 },
        services: { 'contract-probe-api': 'https://rest-contract.test' },
      });
      const probe = client.install(
        createContractProbeFeature({ transport: new InjectedTransport() }),
      );
      expectTypeOf(probe).toEqualTypeOf<ContractProbeApi>();

      const first = probe.read('first');
      const second = probe.read('second');
      await vi.advanceTimersByTimeAsync(0);
      expect(requests).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(499);
      expect(requests).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      await Promise.all([first, second]);
      expect(requests).toHaveLength(2);
      expect(requests[0]?.headers.get('authorization')).toBe('Bearer rest-token');

      await client.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('создаёт независимый модуль для каждого клиента ItdAccounts', async () => {
    const transports: InjectedTransport[] = [];
    const accounts = new ItdAccounts({
      fetch: createContractFetch([]),
      mode: 'server',
      retry: false,
      rateLimit: false,
      services: { 'contract-probe-api': 'https://accounts-contract.test' },
      features: [
        createContractProbeAccountFeature(() => {
          const transport = new InjectedTransport();
          transports.push(transport);
          return { transport };
        }),
      ],
    });

    const first = accounts.addAccount('first', { auth: 'first-token' }) as AccountWithContractProbe;
    const second = accounts.addAccount('second', {
      auth: 'second-token',
    }) as AccountWithContractProbe;

    expect(first.contractProbe).not.toBe(second.contractProbe);
    expect(first.contractProbe.events).not.toBe(second.contractProbe.events);
    expect(transports).toHaveLength(2);
    await first.contractProbe.events.connect();
    await second.contractProbe.events.connect();
    await expect(transports[0]?.context?.getToken()).resolves.toBe('first-token');
    await expect(transports[1]?.context?.getToken()).resolves.toBe('second-token');

    await accounts.dispose();
    expect(transports.map(({ stops }) => stops)).toEqual([1, 1]);
  });
});
