import { USERNAME_PATTERN } from './users.constants.js';

/** @internal */
export function isUsernameFormatValid(username: string): boolean {
  return USERNAME_PATTERN.test(username);
}

/** Ключ сравнения имён: имена уникальны без учёта регистра. @internal */
export function usernameKey(username: string): string {
  return username.toLowerCase();
}
