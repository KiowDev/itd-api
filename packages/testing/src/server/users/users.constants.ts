import { UsernameUnavailableReason } from 'itd-api';

/** Допустимое имя пользователя: латинские буквы, цифры и `_`, от 3 до 32 символов. @internal */
export const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,32}$/;

/**
 * Почему имя пользователя нельзя занять. Причину неверного формата API присылает в `reason`,
 * у занятого имени причины в ответе нет. @internal
 */
export const UsernameIssue = Object.freeze({
  InvalidFormat: UsernameUnavailableReason.InvalidFormat,
  Taken: 'TAKEN',
} as const);
export type UsernameIssue = (typeof UsernameIssue)[keyof typeof UsernameIssue];

/** Роль пользователя в ответе `/api/profile`. @internal */
export const UserRole = Object.freeze({
  User: 'user',
} as const);
export type UserRole = (typeof UserRole)[keyof typeof UserRole];
