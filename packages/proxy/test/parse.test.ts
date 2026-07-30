import { describe, expect, it } from 'vitest';
import { ProxyError } from '../src/errors.js';
import { parseProxy } from '../src/parse.js';

describe('parseProxy', () => {
  it('разбирает socks5 с портом', () => {
    expect(parseProxy('socks5://127.0.0.1:1080')).toMatchObject({
      kind: 'socks5',
      host: '127.0.0.1',
      port: 1080,
      username: undefined,
      password: undefined,
    });
  });

  it('разбирает http с авторизацией', () => {
    expect(parseProxy('http://user:pass@proxy.example:8080')).toMatchObject({
      kind: 'http',
      secure: false,
      host: 'proxy.example',
      port: 8080,
      username: 'user',
      password: 'pass',
    });
  });

  it('распознаёт https как защищённый http-прокси', () => {
    expect(parseProxy('https://proxy.example')).toMatchObject({
      kind: 'http',
      secure: true,
      port: 443,
    });
  });

  it('socks5h ведёт себя как socks5', () => {
    expect(parseProxy('socks5h://host')).toMatchObject({ kind: 'socks5', port: 1080 });
  });

  it('раскодирует спецсимволы в логине и пароле', () => {
    const parsed = parseProxy('socks5://us%40er:p%3Ass@host:1080');
    expect(parsed.username).toBe('us@er');
    expect(parsed.password).toBe('p:ss');
  });

  it('снимает скобки с IPv6-хоста', () => {
    expect(parseProxy('socks5://[::1]:1080').host).toBe('::1');
  });

  it('порт по умолчанию: 80 для http, 443 для https, 1080 для socks', () => {
    expect(parseProxy('http://h').port).toBe(80);
    expect(parseProxy('https://h').port).toBe(443);
    expect(parseProxy('socks5://h').port).toBe(1080);
  });

  it('отвергает неизвестную схему', () => {
    expect(() => parseProxy('ftp://h:1')).toThrow(ProxyError);
  });

  it('отвергает битый адрес', () => {
    expect(() => parseProxy('это не url')).toThrow(ProxyError);
  });

  it('не игнорирует путь, query и fragment', () => {
    expect(() => parseProxy('http://proxy.example/tunnel')).toThrow(ProxyError);
    expect(() => parseProxy('http://proxy.example?token=secret')).toThrow(ProxyError);
    expect(() => parseProxy('http://proxy.example#fragment')).toThrow(ProxyError);
  });

  it('оборачивает неверное percent-кодирование учётных данных', () => {
    expect(() => parseProxy('http://%E0:password@proxy.example')).toThrow(ProxyError);
  });

  it('не печатает пароль прокси в ошибке разбора', () => {
    const error = (() => {
      try {
        parseProxy('socks5//user:s3cr3t@proxy.example:1080');
      } catch (caught) {
        return caught;
      }
    })();

    expect(error).toBeInstanceOf(ProxyError);
    expect(String((error as Error).message)).not.toContain('s3cr3t');
  });

  it('принимает готовый URL', () => {
    expect(parseProxy(new URL('socks5://h:1080')).host).toBe('h');
  });
});
