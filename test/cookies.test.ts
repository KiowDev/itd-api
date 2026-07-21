import { describe, expect, it } from 'vitest';
import { AUTH_FLAG_COOKIE, CookieJar } from '../src/core/cookies.js';

const URL_BASE = 'https://itd.test/api/v1/auth/refresh';

/**
 * Ответ из среды без `Headers.getSetCookie()` — там заголовки приходят одной склеенной строкой.
 *
 * Подменять заголовки у настоящего `Response` нельзя: его конструктор копирует `Headers`
 * в собственный объект, поэтому подмена до него не доходит.
 */
function responseWithJoinedCookies(value: string): Response {
  const headers = new Headers({ 'set-cookie': value });
  // Собственное свойство перекрывает метод из прототипа.
  Object.defineProperty(headers, 'getSetCookie', { value: undefined });
  return { headers } as unknown as Response;
}

describe('разбор Set-Cookie', () => {
  it('не ломается на запятой внутри Expires', () => {
    const jar = new CookieJar();

    jar.setFromStrings(URL_BASE, [
      'refresh_token=abc; Path=/; Expires=Wed, 09 Jun 2027 10:18:14 GMT; HttpOnly; Secure',
      'is_auth=1; Path=/',
    ]);

    expect(jar.getHeader(URL_BASE)).toBe('refresh_token=abc; is_auth=1');
  });

  it('делит склеенную строку заголовков', () => {
    const jar = new CookieJar();

    jar.setFromResponse(
      URL_BASE,
      responseWithJoinedCookies(
        'refresh_token=abc; Path=/; Expires=Wed, 09 Jun 2027 10:18:14 GMT, is_auth=1; Path=/',
      ),
    );

    expect(jar.has('refresh_token')).toBe(true);
    expect(jar.has(AUTH_FLAG_COOKIE)).toBe(true);
  });

  it('читает getSetCookie там, где он есть', () => {
    const jar = new CookieJar();
    const headers = new Headers();
    headers.append('set-cookie', 'a=1; Path=/');
    headers.append('set-cookie', 'b=2; Path=/');

    jar.setFromResponse(URL_BASE, new Response(null, { status: 204, headers }));

    expect(jar.getHeader(URL_BASE)).toBe('a=1; b=2');
  });

  it('перезаписывает cookie с тем же именем', () => {
    const jar = new CookieJar();

    jar.setFromStrings(URL_BASE, ['token=старый; Path=/']);
    jar.setFromStrings(URL_BASE, ['token=новый; Path=/']);

    expect(jar.getHeader(URL_BASE)).toBe('token=новый');
  });
});

describe('срок жизни', () => {
  it('не отдаёт истёкшие cookie', () => {
    const jar = new CookieJar();

    jar.setFromStrings(URL_BASE, ['live=1; Path=/', 'dead=1; Path=/; Max-Age=0']);

    expect(jar.getHeader(URL_BASE)).toBe('live=1');
    expect(jar.has('dead')).toBe(false);
  });

  it('Max-Age важнее Expires', () => {
    const jar = new CookieJar();

    jar.setFromStrings(URL_BASE, ['a=1; Path=/; Expires=Wed, 09 Jun 2027 10:18:14 GMT; Max-Age=0']);

    expect(jar.has('a')).toBe(false);
  });

  it('удаляет cookie, если сервер прислал срок в прошлом', () => {
    const jar = new CookieJar();

    jar.setFromStrings(URL_BASE, ['a=1; Path=/']);
    jar.setFromStrings(URL_BASE, ['a=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT']);

    expect(jar.has('a')).toBe(false);
  });
});

describe('область действия', () => {
  it('не отдаёт cookie чужому origin', () => {
    const jar = new CookieJar();

    jar.setFromStrings('https://itd.test/api', ['a=1; Path=/']);

    expect(jar.getHeader('https://other.test/api')).toBeUndefined();
  });

  it('уважает Path и его границы по сегменту', () => {
    const jar = new CookieJar();

    jar.setFromStrings('https://itd.test/api', ['scoped=1; Path=/api']);

    expect(jar.getHeader('https://itd.test/api/posts')).toBe('scoped=1');
    expect(jar.getHeader('https://itd.test/api')).toBe('scoped=1');
    expect(jar.getHeader('https://itd.test/apiary')).toBeUndefined();
    expect(jar.getHeader('https://itd.test/other')).toBeUndefined();
  });

  it('не отправляет Secure-cookie по http', () => {
    const jar = new CookieJar();

    jar.setFromStrings('https://itd.test/api', ['a=1; Path=/; Secure']);
    jar.setFromStrings('http://itd.test/api', ['b=2; Path=/']);

    expect(jar.getHeader('http://itd.test/api')).toBe('b=2');
  });
});

describe('сохранение и восстановление', () => {
  it('переживает круг сериализации', () => {
    const jar = new CookieJar();
    jar.setFromStrings(URL_BASE, [
      'refresh_token=abc; Path=/; Expires=Wed, 09 Jun 2027 10:18:14 GMT; Secure',
      'is_auth=1; Path=/',
    ]);

    const restored = new CookieJar();
    restored.deserialize(jar.serialize());

    expect(restored.getHeader(URL_BASE)).toBe('refresh_token=abc; is_auth=1');
  });

  it('не сохраняет истёкшие cookie', () => {
    const jar = new CookieJar();
    jar.setFromStrings(URL_BASE, ['a=1; Path=/', 'b=2; Path=/; Max-Age=0']);

    expect(jar.serialize()).toHaveLength(1);
  });

  it('молча пропускает мусор при восстановлении', () => {
    const jar = new CookieJar();

    jar.deserialize(['без-разделителя', '', 'не-url a=1']);

    expect(jar.serialize()).toEqual([]);
  });

  it('deserialize без аргумента ничего не делает', () => {
    const jar = new CookieJar();
    expect(() => jar.deserialize(undefined)).not.toThrow();
  });
});

describe('clear', () => {
  it('удаляет всё', () => {
    const jar = new CookieJar();
    jar.setFromStrings(URL_BASE, ['a=1; Path=/']);

    jar.clear();

    expect(jar.getHeader(URL_BASE)).toBeUndefined();
    expect(jar.has('a')).toBe(false);
  });
});
