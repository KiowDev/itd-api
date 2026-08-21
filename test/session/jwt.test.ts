import { describe, expect, it } from 'vitest';
import {
  readTokenExpiration,
  readTokenIdentity,
  readTokenMetadata,
  readTokenSubject,
} from '../../src/session/jwt.js';
import { makeJwt } from '../helpers/jwt.js';

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

describe('readTokenIdentity', () => {
  it('читает одновременно sub и sid', () => {
    const token = makeJwt({ sub: 'user-1', sid: 'session-1' });

    expect(readTokenIdentity(token)).toEqual({
      subject: 'user-1',
      sessionId: 'session-1',
    });
  });

  it('игнорирует непригодный sid независимо от sub', () => {
    expect(readTokenIdentity(makeJwt({ sub: 'user-1', sid: '' }))).toEqual({
      subject: 'user-1',
    });
    expect(readTokenIdentity(makeJwt({ sub: 'user-1', sid: 42 }))).toEqual({
      subject: 'user-1',
    });
  });
});

describe('readTokenMetadata', () => {
  it('читает идентификаторы и срок за один проход', () => {
    const token = makeJwt({ sub: 'user-1', sid: 'session-1', exp: 1_700_000_123 });

    expect(readTokenMetadata(token)).toEqual({
      subject: 'user-1',
      sessionId: 'session-1',
      expiresAt: 1_700_000_123_000,
    });
  });
});

describe('readTokenExpiration', () => {
  it('переводит NumericDate exp из секунд в миллисекунды', () => {
    expect(readTokenExpiration(makeJwt({ exp: 1_700_000_123 }))).toBe(1_700_000_123_000);
  });

  it('не угадывает срок непрозрачного или повреждённого токена', () => {
    expect(readTokenExpiration('opaque-token')).toBeUndefined();
    expect(readTokenExpiration('header.invalid.signature')).toBeUndefined();
  });

  it('игнорирует отсутствующий и некорректный exp', () => {
    expect(readTokenExpiration(makeJwt({ sub: 'user' }))).toBeUndefined();
    expect(readTokenExpiration(makeJwt({ exp: '1700000123' }))).toBeUndefined();
    expect(readTokenExpiration(makeJwt({ exp: Number.NaN }))).toBeUndefined();
  });
});
