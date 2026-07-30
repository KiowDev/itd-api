# Авторизация — `itd.auth`

Вход, регистрация, подтверждение по коду, пароли и управление сессиями. Обычно
клиент авторизуется сам через опцию `auth` конструктора; эти методы нужны для ручных
сценариев входа. Полное руководство — [Авторизация](../authentication/README.md).

Вход, регистрация и сброс пароля требуют одноразовый **Turnstile token**. Ключ виджета —
экспорт `TURNSTILE_SITE_KEY`.

## Состояние авторизации

```ts
check(): Promise<AuthState>
```
Проверяет состояние авторизации и возвращает `{ authenticated, banned, user }`.
Метод работает без токена: тогда `authenticated` равен `false`, а `user` — `null`.

## Вход и регистрация

```ts
signUp(credentials: CaptchaCredentials): Promise<string>
```
Регистрирует аккаунт и запускает подтверждение по коду. Возвращает `flowToken` для `verifyOtp()`.

```ts
signIn(credentials: CaptchaCredentials): Promise<SignInResult>
```
Выполняет вход. При успехе токен сохраняется в клиенте автоматически. Если сервер потребовал
код, вернётся `{ status: 'otp_required', flowToken }`.

```ts
signInWithOtp(input: CaptchaCredentials & { getOtp: () => string | Promise<string> }): Promise<string>
```
Полный вход с подтверждением: код запрашивается функцией `getOtp`, остальное — само. Возвращает
`accessToken`.

```ts
verifyOtp(input: Credentials & { otp: string; flowToken: string }): Promise<string>
```
Подтверждает вход кодом из письма. Токен сохраняется автоматически.

```ts
resendOtp(input: { email: string; flowToken: string }): Promise<void>
```
Отправляет код подтверждения повторно.

## Сессия

```ts
refresh(): Promise<string>
```
Обновляет токен доступа. Параллельные вызовы объединяются в один сетевой запрос. При включённом
`autoRefresh` вручную обычно не нужен.

```ts
hasRefreshSession(): Promise<boolean>
```
Есть ли признак живой сессии обновления (cookie `is_auth` или строковый refresh-токен).
В браузере всегда `true`. Читает хранилище — верен и до первого запроса.

```ts
logout(): Promise<void>
```
Завершает текущую сессию на сервере и очищает локальную.

```ts
logoutAll(): Promise<void>
```
Завершает все сессии пользователя и очищает локальную.

```ts
signOut(): Promise<void>
```
Забывает сессию локально, не обращаясь к серверу.

## Пароли

```ts
forgotPassword(input: ForgotPasswordInput): Promise<string>
```
Запрашивает письмо с кодом для сброса. Возвращает `flowToken` для `resetPassword()`.

```ts
resetPassword(input: ResetPasswordInput): Promise<void>
```
Устанавливает новый пароль по коду. Нужны все четыре поля: `email`, `otp`, `flowToken`, `newPassword`.

```ts
resetPasswordWithOtp(input: ForgotPasswordInput & { newPassword: string; getOtp: () => string | Promise<string> }): Promise<void>
```
Полный сброс: код запрашивается функцией `getOtp`, остальное — само.

```ts
changePassword(input: { currentPassword: string; newPassword: string }): Promise<void>
```
Меняет пароль. Требует действующей сессии. При неверном текущем пароле — код
`ACCOUNT_CURRENT_PASSWORD_INCORRECT`.

## Управление сессиями

```ts
sessions(): Promise<Session[]>
```
Список активных сессий. У текущей `isCurrent === true`. См. [`Session`](./models.md#session).

```ts
revokeSession(sessionId: string): Promise<void>
```
Завершает указанную сессию.

```ts
revokeOtherSessions(): Promise<void>
```
Завершает все сессии, кроме текущей.

## Типы

```ts
interface AuthState {
  authenticated: boolean;
  banned: boolean;
  user: MyProfile | null;
}

interface Credentials {
  email: string;
  password: string;
}

interface CaptchaCredentials extends Credentials {
  turnstileToken: string;                // одноразовый, живёт несколько минут
}

interface ForgotPasswordInput {
  email: string;
  turnstileToken: string;
}

interface ResetPasswordInput {
  email: string;
  otp: string;
  flowToken: string;
  newPassword: string;
}

type SignInResult =
  | { status: 'authenticated'; accessToken: string }
  | { status: 'otp_required'; flowToken: string | undefined };

const SignInStatus = { Authenticated: 'authenticated', OtpRequired: 'otp_required' } as const;
```

Связанные: [`AuthInput`](./client.md#авторизация-authinput) (как клиент получает доступ),
события авторизации `itd.on('tokens' | 'authError' | …)` — см. [Клиент](./client.md#события).
