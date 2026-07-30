import { createServer, type Server } from 'node:http';
import { connect as netConnect } from 'node:net';
import { Agent, type Dispatcher, ProxyAgent } from 'undici';
import { afterEach, describe, expect, it } from 'vitest';
import { createProxyDispatcher } from '../src/dispatcher.js';
import { ProxyError } from '../src/errors.js';
import { proxyFetch } from '../src/index.js';

// Диспетчеры держат пул соединений — закрываем их, чтобы тесты не оставляли открытых хэндлов.
const opened: Dispatcher[] = [];
function track<T extends Dispatcher>(dispatcher: T): T {
  opened.push(dispatcher);
  return dispatcher;
}

afterEach(async () => {
  await Promise.all(opened.splice(0).map((dispatcher) => dispatcher.close()));
});

describe('createProxyDispatcher', () => {
  it('для http-прокси собирает ProxyAgent', () => {
    const dispatcher = track(createProxyDispatcher('http://127.0.0.1:8080'));
    expect(dispatcher).toBeInstanceOf(ProxyAgent);
  });

  it('для http-прокси с авторизацией тоже собирает ProxyAgent', () => {
    const dispatcher = track(createProxyDispatcher('http://user:pass@127.0.0.1:8080'));
    expect(dispatcher).toBeInstanceOf(ProxyAgent);
  });

  it('для socks5-прокси собирает Agent с подменённым соединением', () => {
    const dispatcher = track(createProxyDispatcher('socks5://127.0.0.1:1080'));
    expect(dispatcher).toBeInstanceOf(Agent);
  });

  it('для IPv6 http-прокси собирает корректный ProxyAgent', () => {
    const dispatcher = track(createProxyDispatcher('http://[::1]:8080'));
    expect(dispatcher).toBeInstanceOf(ProxyAgent);
  });

  it('на неизвестную схему бросает ProxyError', () => {
    expect(() => createProxyDispatcher('ftp://127.0.0.1:1')).toThrow(ProxyError);
  });
});

describe('proxyFetch', () => {
  it('подставляет диспетчер прокси в вызов fetch', async () => {
    const calls: Array<{ dispatcher: unknown }> = [];
    const fakeFetch = ((_input: unknown, init: { dispatcher?: unknown } = {}) => {
      calls.push({ dispatcher: init.dispatcher });
      return Promise.resolve(new Response('ok'));
    }) as unknown as typeof fetch;

    const fetchViaProxy = proxyFetch('http://127.0.0.1:8080', { fetch: fakeFetch });
    await fetchViaProxy('https://example.test');

    expect(calls).toHaveLength(1);
    const dispatcher = calls[0]?.dispatcher;
    expect(dispatcher).toBeInstanceOf(ProxyAgent);
    await (dispatcher as Dispatcher).close();
  });

  it('сохраняет переданные заголовки и метод', async () => {
    let seen: RequestInit | undefined;
    const fakeFetch = ((_input: unknown, init?: RequestInit) => {
      seen = init;
      return Promise.resolve(new Response('ok'));
    }) as unknown as typeof fetch;

    const fetchViaProxy = proxyFetch('socks5://127.0.0.1:1080', { fetch: fakeFetch });
    await fetchViaProxy('https://example.test', {
      method: 'POST',
      headers: { 'X-Test': '1' },
    });

    expect(seen).toBeDefined();
    const init = seen as RequestInit & { dispatcher?: Dispatcher };
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['X-Test']).toBe('1');
    await (init.dispatcher as Dispatcher).close();
  });

  it('пробрасывает ошибку разбора адреса сразу при создании', () => {
    expect(() => proxyFetch('ftp://nope')).toThrow(ProxyError);
  });

  it('по умолчанию реально отправляет запрос через HTTP-прокси', async () => {
    const proxied: string[] = [];
    const reachedTarget: string[] = [];

    const target = createServer((request, response) => {
      reachedTarget.push(request.url ?? '');
      response.writeHead(200, { 'Content-Type': 'text/plain', Connection: 'close' });
      response.end('proxied');
    });

    const proxy = createServer();
    proxy.on('connect', (request, clientSocket, head) => {
      proxied.push(request.url ?? '');
      const [host, port] = (request.url ?? '').split(':');
      const upstream = netConnect(Number(port), host, () => {
        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length > 0) upstream.write(head);
        upstream.pipe(clientSocket);
        clientSocket.pipe(upstream);
      });
      upstream.on('error', () => clientSocket.destroy());
    });

    const listen = (server: Server) =>
      new Promise<number>((resolve) => {
        server.listen(0, '127.0.0.1', () => {
          const address = server.address();
          if (address === null || typeof address === 'string')
            throw new Error('unexpected address');
          resolve(address.port);
        });
      });
    const close = (server: Server) =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );

    const targetPort = await listen(target);
    const proxyPort = await listen(proxy);

    try {
      const fetchViaProxy = proxyFetch(`http://127.0.0.1:${proxyPort}`);
      const response = await fetchViaProxy(`http://127.0.0.1:${targetPort}/proxied?x=1`);

      expect(await response.text()).toBe('proxied');
      expect(proxied).toEqual([`127.0.0.1:${targetPort}`]);
      expect(reachedTarget).toEqual(['/proxied?x=1']);
    } finally {
      await close(proxy);
      await close(target);
    }
  });
});
