import { UsernameUnavailableReason } from 'itd-api';

/**
 * Допустимое имя пользователя: от 3 до 20 латинских букв, цифр и `_`, начинается с буквы,
 * без `_` в конце и двух `_` подряд. @internal
 */
export const USERNAME_PATTERN = /^(?=.{3,20}$)[A-Za-z](?:_?[A-Za-z0-9])*$/;

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
