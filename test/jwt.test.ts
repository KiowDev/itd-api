import { describe, expect, it } from 'vitest';
import { readTokenSubject } from '../src/core/jwt.js';
import { makeJwt } from './helpers/jwt.js';

describe('readTokenSubject', () => {
  it('читает sub из полезной нагрузки', () => {
    const token = makeJwt({ sub: '0193a1b2-c3d4-7e8f-9012-3456789abcde', exp: 1 });

    expect(readTokenSubject(token)).toBe('0193a1b2-c3d4-7e8f-9012-3456789abcde');
  });

  it('разбирает нагрузку с кириллицей', () => {
    // base64 из atob возвращает «бинарную» строку: без декодирования в UTF-8
    // такой JSON не разобрался бы.
    const token = makeJwt({ sub: 'user-1', nickname: 'Пётр', bio: 'привет 👋' });

    expect(readTokenSubject(token)).toBe('user-1');
  });

  it('токен не в формате JWT читается как отсутствие идентификатора', () => {
    expect(readTokenSubject('просто-строка-токена')).toBeUndefined();
    expect(readTokenSubject('')).toBeUndefined();
  });

  it('повреждённая нагрузка не бросает исключение', () => {
    expect(readTokenSubject('header.это-не-base64-json.signature')).toBeUndefined();
    expect(readTokenSubject('header..signature')).toBeUndefined();
  });

  it('нагрузка без пригодного sub даёт undefined', () => {
    expect(readTokenSubject(makeJwt({ exp: 1 }))).toBeUndefined();
    expect(readTokenSubject(makeJwt({ sub: '' }))).toBeUndefined();
    expect(readTokenSubject(makeJwt({ sub: 42 }))).toBeUndefined();
    expect(
      readTokenSubject(makeJwt(['список'] as unknown as Record<string, unknown>)),
    ).toBeUndefined();
  });
});
