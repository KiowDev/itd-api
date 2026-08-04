# Справочник API

Справочник пользовательского API `itd-api`. В отличие от [руководств](/guides/),
здесь нет больших сценариев — только доступные через клиент методы, их параметры,
возвращаемые типы и основные вспомогательные функции.

## Ресурсы клиента

| Категория | Доступ | О чём |
|---|---|---|
| [Клиент](./client.md) | `new ItdClient()` | конструктор, `request()`, `use()`, сервисы, события, `realtime()`, `close()`, `dispose()` |
| [Авторизация](./auth.md) | `itd.auth` | вход, регистрация, OTP, пароли, сессии |
| [Пользователи](./users.md) | `itd.users` | профили, подписки, блокировки, приватность, значки |
| [Посты](./posts.md) | `itd.posts` | лента, публикация, реакции, репосты, опросы, комментарии к постам |
| [Комментарии](./comments.md) | `itd.comments` | ответы на комментарии и действия над ними |
| [Уведомления](./notifications.md) | `itd.notifications` | список, счётчик, отметки о прочтении, настройки |
| [Файлы](./files.md) | `itd.files` | загрузка и удаление медиа |
| [Поиск и обнаружение](./discovery.md) | `itd.search`, `itd.hashtags` | глобальный поиск, хэштеги, тренды, рекомендации, кланы, портал |
| [Подписка](./subscription.md) | `itd.subscription` | состояние премиума, автопродление, способы оплаты |
| [Верификация](./verification.md) | `itd.verification` | статус и подача заявки |
| [Жалобы](./reports.md) | `itd.reports` | жалобы на контент и пользователей |
| [Платформа](./platform.md) | `itd.platform` | версии приложений, журнал изменений, анонсы, портал, статус сервисов |
| [Телеметрия](./telemetry.md) | `itd.telemetry` | явная отправка просмотров и взаимодействий |
| [Realtime](./realtime.md) | `itd.realtime()` | поток уведомлений, composer/router, транспорт, переподключение |
| [Request pipeline](./request-pipeline.md) | `operations` / `attempts` | границы логической операции, сетевой попытки, retry, auth и queue |

## Несколько аккаунтов

| Категория | Доступ | О чём |
|---|---|---|
| [Аккаунты](./accounts.md) | `new ItdAccounts()` | контейнер именованных клиентов с общим хранилищем |

## Справочники типов

| Файл | О чём |
|---|---|
| [Модели данных](./models.md) | `Post`, `Comment`, `Profile`, `Notification`, `Attachment` и остальные ответы API |
| [Перечисления](./enums.md) | `FeedTab`, `SpanType`, `NotificationType`, `ReportReason` и прочие |
| [Ошибки](./errors.md) | иерархия `ItdError`, коды `ItdErrorCode`, функции-предикаты |
| [Билдеры](./builders.md) | `post()`, `comment()`, `poll()`, `report()`, `markup()`, `renderSpans()` |
| [Пагинация](./pagination.md) | `Page<T>`, `Paginator<T>`, три схемы под одним `for await` |
| [Сессии и хранилища](./storage.md) | `ItdSession`, одно- и мультиаккаунтные storage, `itd-api/node` |
| [Матрица endpoint](./endpoints.md) | wire-контракты, авторизация, статус поддержки и дата проверки |

## Общие соглашения

**`RequestOptions` в каждом методе.** Почти все методы ресурсов принимают необязательный
последний аргумент `options: RequestOptions` — он не повторяется в сигнатурах ниже:

```ts
interface RequestOptions {
  signal?: AbortSignal;                  // отмена запроса
  timeout?: number;                      // таймаут только этого запроса, мс
  headers?: Record<string, string>;      // дополнительные заголовки
  retry?: RetryOptions | false;          // повторы только этого запроса
  retrySafety?: RetrySafety;             // точечная семантика повтора custom/raw operation
  extensions?: RequestExtensions;        // namespace настроек подключённых плагинов
}

interface RequestExtensions {}           // расширяется пакетами через declaration merging

interface PaginationOptions extends RequestOptions {
  maxPages?: number;                     // предел только для методов-итераторов
}
```

Параметры endpoint и выполнения запроса не смешиваются. Если методу нужны собственные параметры,
они идут отдельным объектом раньше последнего `RequestOptions`: `list(params, requestOptions)`.
Методы-итераторы вместо него принимают `PaginationOptions`.

**`UserRef` против `UserId`.** `UserRef` — это UUID **или** имя пользователя: подходят оба
(`itd.users.get('nowkie')` и `itd.users.get('9f1c…')`). `UserId` — строго UUID; имя
пользователя там не работает (например, `wallRecipientId`).

**Даты.** Все поля дат — строки ISO-8601 (`IsoDate`). Библиотека не превращает их в `Date`;
для разбора есть [`toDate()`](./models.md#вспомогательные-функции).

**Пагинация.** Методы-списки идут парами: `list()`/`comments()`/… возвращают одну
[`Page<T>`](./pagination.md), а `iterate()`/`iterateComments()`/… — [`Paginator<T>`](./pagination.md)
для `for await`. Подробнее — в [пагинации](./pagination.md).

**Снятие обёртки.** Сервер оборачивает ответы в `{ data: … }`; библиотека снимает обёртку
сама. Чтобы получить тело как есть, используйте `itd.request({ …, raw: true })`.
