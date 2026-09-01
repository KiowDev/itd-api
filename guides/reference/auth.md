# Авторизация — `itd.auth`

Вход, регистрация, подтверждение по коду, пароли и управление сессиями. Обычно
клиент авторизуется сам через опцию `auth` конструктора; эти методы нужны для ручных
сценариев входа. Полное руководство — [Авторизация](../authentication/).

Капчу требуют `signIn()`, `signUp()` и `forgotPassword()` (и надстройки над ними), а
`claimQrLogin()` может запросить её отдельным статусом. Токен эти методы берут из опции
клиента `captcha`; поле `captcha: { type, token }` передаётся, только когда токен уже на
руках. Имя поля запроса SDK подставляет сам. Активного провайдера сообщает
`captchaProvider()`, токены одноразовые. В Node виджеты проходит
[`@itd-api/captcha`](/packages/captcha).

Без источника и без токена запрос всё равно уходит на сервер: требовать ли капчу, решает он.

Остальным методам капча не нужна. `refresh()`, `check()`, `logout()` и работа с сессиями
обходятся без неё, поэтому [готовые токены из браузера](../authentication/#токены-из-браузера)
или сохранённая сессия позволяют вообще не встречаться с капчей.

## Провайдер капчи

```ts
captchaProvider(): Promise<CaptchaProvider>
```

Возвращает `{ provider: 'itd', field: 'token' }` либо
`{ provider: 'cloudflare', field: 'turnstileToken' }`. Оба значения сервер вправе сменить,
поэтому `field` берётся из ответа, а не выводится из провайдера.

Автологину через опцию `auth` этот вызов не нужен — клиент делает его сам. Ручному входу
он подсказывает, какой виджет решать:

```ts
const { provider, field } = await itd.auth.captchaProvider();
const token = await solveCaptcha(provider);

await itd.auth.signIn({ email, password, captcha: { type: provider, token, field } });
```

## Состояние авторизации

```ts
check(): Promise<AuthState>
```
Проверяет состояние авторизации и возвращает `{ authenticated, banned, user }`.
Метод работает без токена: тогда `authenticated` равен `false`, а `user` — `null`.

## Вход и регистрация

```ts
signUp(credentials: CredentialsWithCaptcha): Promise<string>
```
Регистрирует аккаунт и запускает подтверждение по коду. Возвращает `flowToken` для `verifyOtp()`.

```ts
signIn(credentials: CredentialsWithCaptcha): Promise<SignInResult>
```
Выполняет вход. При успехе токен сохраняется в клиенте автоматически. Если сервер потребовал
код, вернётся `{ status: 'otp_required', flowToken }`.

```ts
signInWithOtp(input: CredentialsWithCaptcha & { getOtp: () => string | Promise<string> }): Promise<string>
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

## QR-вход

```ts
startQrLogin(): Promise<QrLoginStart>
```

Создаёт изолированную короткоживущую QR-сессию. `payload` нужно закодировать в QR-код;
`claimToken` нельзя включать в QR-код или передавать сканирующему устройству.
`captchaRequired` предупреждает, что для завершения понадобится капча; свежий токен лучше
получать после `approved`, а не при показе QR-кода.

```ts
streamQrLogin(
  input: { qrId: string; claimToken: string },
  onEvent: (event: QrLoginStreamEvent) => void | Promise<void>,
  options?: { signal?: AbortSignal },
): Promise<void>
```

Доставляет простые SSE-события `pending`, `scanned`, `approved`, `rejected`. После
`approved` вызовите `claimQrLogin()`; поток сам токен не возвращает. Отмена выполняется
стандартным `AbortSignal`.

Метод делает одну попытку подключения. Если первое событие не пришло за 3 секунды либо поток
закрылся, остановите его и вызывайте `claimQrLogin()` раз в 2 секунды. После `approved`
вызовите `claimQrLogin()` сразу. Опрос прекращается на `authorized`, `captcha_required`,
`rejected`, при истечении QR-сессии или закрытии экрана.

```ts
claimQrLogin(input: QrLoginClaimInput): Promise<QrLoginClaim>
```

Проверяет и завершает QR-вход. При `authorized` клиент автоматически сохраняет access token
и cookie новой сессии. После `captcha_required` следующий вызов добавит токен капчи сам —
из опции клиента либо из аргумента вызова. До просьбы сервера токен не запрашивается:
опрос идёт в цикле, и поднимать браузер на каждую проверку было бы напрасно. В серверной
среде cookie QR-сессии хранятся отдельно; в браузере ими управляет сам браузер.

## Сессия

```ts
refresh(): Promise<string>
```
Обновляет токен доступа. Параллельные вызовы объединяются в один сетевой запрос. При включённом
`autoRefresh` вручную обычно не нужен. Refresh-токен уходит на сервер cookie `refresh_token`
(тело запроса игнорируется), а в ответе вместе с новым access token приходит **новый**
refresh-токен: прежний в этот момент гаснет. Обновлённая сессия сразу записывается в `storage`.

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
  user: AuthUser | null;
}

interface AuthUser {
  id: UserId; username: string; displayName: string;
  avatar: string; bio: string; verified: boolean;
  isPhoneVerified: boolean; roles: string[];
}

interface Credentials {
  email: string;
  password: string;
}

interface CaptchaToken {
  type: CaptchaType;          // 'itd' | 'cloudflare' | новый от сервера
  token: string;
  field?: CaptchaField;       // по умолчанию — CAPTCHA_FIELDS[type]
}

type CredentialsWithCaptcha = Credentials & { captcha?: CaptchaToken };

interface ForgotPasswordInput {
  email: string;
  captcha?: CaptchaToken;
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

interface CaptchaProvider {
  provider: CaptchaType;
  field: CaptchaField;
}

const CaptchaType = { Itd: 'itd', Cloudflare: 'cloudflare' } as const;
const CaptchaField = { Itd: 'token', Cloudflare: 'turnstileToken' } as const;
const CAPTCHA_FIELDS = { itd: 'token', cloudflare: 'turnstileToken' } as const;

interface QrLoginStart {
  qrId: string; claimToken: string; payload: string;
  expiresIn: number; captchaRequired: boolean;
}

type QrLoginStreamEvent = {
  status: 'pending' | 'scanned' | 'approved' | 'rejected';
  expiresIn?: number;
};
```

Связанные: [`AuthInput`](./client.md#авторизация-authinput) (как клиент получает доступ),
события авторизации `itd.on('tokens' | 'authError' | …)` — см. [Клиент](./client.md#события).
