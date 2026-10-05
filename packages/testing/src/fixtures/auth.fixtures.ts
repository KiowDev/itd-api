import type { ItdSession } from 'itd-api';
import { FIXTURE_TIME, FIXTURE_USER_ID } from './fixtures.constants.js';
import type { AccessTokenFixtureOptions } from './fixtures.types.js';

/** Сессия хранилища клиента. */
export function sessionFixture(input: Partial<ItdSession> = {}): ItdSession {
  return {
    accessToken: accessTokenFixture(),
    refreshToken: 'test-refresh-token',
    deviceId: '00000000-0000-4000-8000-000000000099',
    obtainedAt: new Date(FIXTURE_TIME).getTime(),
    ...input,
  };
}

function encodeSegment(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/** Создаёт синтаксически корректный тестовый JWT. Токен не подписан настоящим ключом. */
export function jwtFixture(payload: Readonly<Record<string, unknown>> = {}): string {
  return `${encodeSegment({ alg: 'HS256', typ: 'JWT' })}.${encodeSegment(payload)}.test-signature`;
}

/** Тестовый токен доступа с идентификаторами пользователя и сессии. */
export function accessTokenFixture(options: AccessTokenFixtureOptions = {}): string {
  const issuedAt = options.issuedAt ?? Math.floor(new Date(FIXTURE_TIME).getTime() / 1000);
  return jwtFixture({
    sub: options.userId ?? FIXTURE_USER_ID,
    sid: options.sessionId ?? 'test-session',
    iat: issuedAt,
    exp: options.expiresAt ?? issuedAt + 31_536_000,
    ...options.payload,
  });
}
