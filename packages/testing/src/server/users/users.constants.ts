/** Допустимое имя пользователя: латинские буквы, цифры и `_`, от 3 до 32 символов. @internal */
export const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,32}$/;

/** Почему имя пользователя нельзя занять. Значения совпадают с `reason` ответа API. @internal */
export const UsernameIssue = Object.freeze({
  InvalidFormat: 'INVALID_FORMAT',
  Taken: 'TAKEN',
} as const);
export type UsernameIssue = (typeof UsernameIssue)[keyof typeof UsernameIssue];
