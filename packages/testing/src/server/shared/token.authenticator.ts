import type { MockRequest } from '../../http/request.types.js';
import type { UserService } from '../users/users.service.js';
import type { UserRecord } from '../users/users.types.js';

function decodeTokenPayload(token: string): Record<string, unknown> | undefined {
  try {
    const segment = token.split('.')[1];
    if (!segment) return undefined;
    const normalized = segment
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(segment.length / 4) * 4, '=');
    return JSON.parse(atob(normalized)) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/** Определяет пользователя по `sub` тестового JWT из заголовка `Authorization`. @internal */
export class TokenAuthenticator {
  readonly #users: UserService;

  constructor(users: UserService) {
    this.#users = users;
  }

  authenticate(request: MockRequest): UserRecord | undefined {
    const value = request.headers.get('authorization');
    if (!value?.startsWith('Bearer ')) return undefined;
    const sub = decodeTokenPayload(value.slice(7))?.sub;
    return typeof sub === 'string' ? this.#users.get(sub) : undefined;
  }
}
