# Ошибки

Все ошибки библиотеки — подклассы `ItdError`. Ошибки сервера (HTTP ≥ 400) сведены к одной
иерархии `ItdApiError` независимо от формы ответа.

```ts
try {
  await itd.users.updateMe({ username: 'занятое_имя' });
} catch (error) {
  if (error instanceof ItdValidationError) error.fieldErrors.username;  // ['Имя уже занято']
  else if (error instanceof ItdRateLimitError) error.rateLimitRemaining;
  else if (isItdApiError(error)) console.log(error.status, error.code);
  else throw error;
}
```

## Иерархия

```
ItdError
├─ ItdApiError            сервер ответил статусом ≥ 400
│  ├─ ItdValidationError        400 / 422 — данные не прошли валидацию
│  ├─ ItdAuthError              401 — токен отсутствует, истёк или отозван
│  ├─ ItdForbiddenError         403 — доступ запрещён или ограничен приватностью
│  ├─ ItdNotFoundError          404 — сущность не найдена
│  ├─ ItdConflictError          409 — сущность уже существует
│  ├─ ItdRateLimitError         429 — превышен лимит запросов
│  ├─ ItdPhoneVerificationError PHONE_VERIFICATION_REQUIRED
│  └─ ItdServerError            5xx — ошибка на стороне сервера
├─ ItdNetworkError        запрос не дошёл до сервера
├─ ItdFileError           не удалось получить или прочитать источник вложения
├─ ItdTimeoutError        истёк таймаут
├─ ItdAbortError          отменён через AbortSignal
└─ ItdConfigError         неверная конфигурация или аргументы (до обращения к сети; бросают билдеры)
```

Категория ошибки — в поле `kind` (`ItdErrorKind`): `'api'` | `'file'` | `'network'` |
`'timeout'` | `'abort'` | `'config'`.

## `ItdApiError`

```ts
class ItdApiError extends ItdError {
  status: number;                        // HTTP-статус
  code: ItdErrorCode;                    // строковый код, например 'VALIDATION_ERROR'
  detail: string | undefined;
  title: string | undefined;
  fieldErrors: ItdFieldErrors;           // { поле: ['ошибка'] }; {} если нет
  requestId: string | undefined;
  method: string;
  path: string;
  raw: unknown;                          // тело ответа как пришло
  response: Response | undefined;
  retryAfter: number | undefined;        // мс; итд.com его не присылает
  rateLimit: number | undefined;         // x-ratelimit-limit
  rateLimitRemaining: number | undefined;// x-ratelimit-remaining
  apiKind: ItdApiErrorKind;              // разновидность для сравнения

  hasCode(...codes: ItdErrorCode[]): boolean;   // проверить код
  get isRetryable: boolean;                     // 429 или ≥ 500
}
```

`ItdPhoneVerificationError` дополнительно даёт `verificationUrl` — ссылку на Telegram-бота
подтверждения.

`ItdNetworkError` / `ItdTimeoutError` содержат `method` и `path`; `ItdTimeoutError` — ещё
и `timeout`.

## `ItdFileError`

Ошибка чтения источника вложения отделена от сбоя запроса к итд.com:

```ts
class ItdFileError extends ItdError {
  reason: ItdFileErrorReason;  // network | http | too_large | stream_unavailable | read
  url?: string;
  status?: number;
  limit?: number;
  actual?: number;
  retryable: boolean;
}
```

`retryable` описывает источник: сетевой сбой и временный HTTP-статус можно повторить.
Фактическое число попыток задают общие настройки `retry`.

## Функции-предикаты

Определяют ошибку **по данным**, а не через `instanceof` (надёжнее при двух копиях пакета
или смешении ESM/CJS):

```ts
isItdError(v)              // любая ошибка библиотеки
isItdApiError(v)           // ответ сервера ≥ 400
isItdFileError(v)          // получение или чтение источника вложения
isItdValidationError(v)
isItdAuthError(v)
isItdForbiddenError(v)
isItdNotFoundError(v)
isItdConflictError(v)
isItdRateLimitError(v)
isItdPhoneVerificationError(v)
isItdServerError(v)
```

## Коды ошибок — `ItdErrorCode`

Строковые коды из поля `code`. Список открыт. Ключи повторяют написание сервера — код из
ответа можно найти поиском один в один. Проверять удобно через `error.hasCode(…)`.

Основные группы:

- **Общие:** `BAD_REQUEST`, `UNAUTHORIZED`, `ACCESS_DENIED`, `ENTITY_NOT_FOUND`, `NOT_FOUND`,
  `ENTITY_ALREADY_EXISTS`, `VALIDATION_ERROR`, `BUSINESS_RULE_VIOLATION`, `RATE_LIMIT_EXCEEDED`,
  `UNKNOWN_ERROR`.
- **Капча/OTP:** `TURNSTILE_VERIFICATION_FAILED`, `CAPTCHA_FAILED`, `OTP_INVALID`,
  `INVALID_FLOW_TOKEN`, `MISSING_FLOW_TOKEN`.
- **Аккаунт:** `ACCOUNT_DEACTIVATED`, `ACCOUNT_INVALID_CREDENTIALS`, `ACCOUNT_TEMPORARILY_LOCKED`,
  `ACCOUNT_CURRENT_PASSWORD_INCORRECT`, `ACCOUNT_EMAIL_DOMAIN_NOT_ALLOWED`.
- **Сессия:** `SESSION_EXPIRED`, `SESSION_REVOKED`, `SESSION_INVALID_REFRESH_TOKEN`,
  `SESSION_NOT_FOUND`, `REFRESH_TOKEN_MISSING`.
- **Профиль/контент:** `PROFILE_USERNAME_TAKEN`, `PROFILE_RESTRICTION_ACTIVE`,
  `PROFILE_MODIFICATION_RESTRICTED`, `CONTENT_MODERATION_FAILED`, `WRITE_ACCESS_RESTRICTED`.
- **Файлы:** `FILE_TOO_LARGE`, `UNSUPPORTED_FILE_TYPE`, `UPLOAD_FAILED`,
  `VIDEO_REQUIRES_VERIFICATION`.
- **Телефон:** `PHONE_VERIFICATION_REQUIRED`.
