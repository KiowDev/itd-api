import { USERNAME_PATTERN } from './users.constants.js';
import type { UserRecord } from './users.types.js';

/** @internal */
export function isUsernameFormatValid(username: string): boolean {
  return USERNAME_PATTERN.test(username);
}

/** Ключ сравнения имён: имена уникальны без учёта регистра. @internal */
export function usernameKey(username: string): string {
  return username.toLowerCase();
}

/** Аватар — адрес изображения, а не эмодзи клана. @internal */
export function isImageAvatar(avatar: string): boolean {
  return /^https?:\/\//i.test(avatar);
}

/** Клан пользователя: `clanAvatar`, а без него — эмодзи-аватар. @internal */
export function clanOf(user: Pick<UserRecord, 'profile'>): string {
  return user.profile.clanAvatar ?? user.profile.avatar;
}
