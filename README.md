# itd-api

[![npm version](https://img.shields.io/npm/v/itd-api.svg)](https://www.npmjs.com/package/itd-api)
[![npm downloads](https://img.shields.io/npm/dm/itd-api.svg)](https://www.npmjs.com/package/itd-api)
[![CI](https://github.com/KiowDev/itd-api/actions/workflows/ci.yml/badge.svg)](https://github.com/KiowDev/itd-api/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/node/v/itd-api.svg)](https://www.npmjs.com/package/itd-api)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0%2B-3178c6.svg)](./tsconfig.json)
[![license](https://img.shields.io/npm/l/itd-api.svg)](./LICENSE)

Независимый TypeScript-клиент REST и realtime API социальной сети **итд.com**.
Проект не является официальным SDK и не аффилирован с итд.com.

[Быстрый старт](./guides/quickstart/README.md) ·
[Руководства](./guides/README.md) ·
[Справочник API](./guides/reference/README.md) ·
[Совместимость](#совместимость) ·
[Сеть и доверие](#сеть-и-доверие) ·
[Пакеты проекта](#пакеты-проекта)

## Установка

```bash
npm install itd-api
```

Первый публичный запрос не требует токена:

```ts
import { ItdClient } from 'itd-api';

const itd = new ItdClient();
const versions = await itd.platform.version();

console.log(versions.android.latestVersion);
```

Для авторизованных запросов передайте готовый токен, восстановите сохранённую сессию
или настройте вход по
[руководству по авторизации](./guides/authentication/README.md).

## Возможности

| Область | Что поддерживается |
|---|---|
| REST API | пользователи, посты, комментарии, файлы, уведомления, поиск, жалобы, верификация и подписка |
| Авторизация | access/refresh token, автоматическое обновление, OTP, хранение сессии и несколько аккаунтов |
| Realtime | SSE с переподключением и fallback на polling |
| Пагинация | разные серверные схемы через единый `for await` |
| Публикация | билдеры постов, комментариев, опросов, разметки текста и загрузки файлов |
| Надёжность | таймауты, отмена, очередь, rate limiting, безопасные повторы, хуки и типизированные ошибки |
| Расширение | плагины, собственный `fetch`, сервисы и произвольные запросы |
| Платформа | версии приложений, changelog, анонсы, портал и состояние сервисов |

У основного пакета нет runtime-зависимостей. Он поставляется как ESM и CommonJS с
полными TypeScript-типами.

## Пакеты проекта

Все пакеты в таблице поддерживаются проектом itd-api.

| Пакет | Назначение | Среда | npm | Документация |
|---|---|---|---|---|
| `itd-api` | REST/realtime-клиент | Node.js 18+, браузер, Bun, Deno, React Native | [npm](https://www.npmjs.com/package/itd-api) | [быстрый старт](./guides/quickstart/README.md) |
| `@itd-api/cache` | TTL/LRU-кэш и дедупликация запросов | среды основного клиента | [npm](https://www.npmjs.com/package/@itd-api/cache) | [README](./packages/cache/README.md) |
| `@itd-api/crypto` | скрытые сообщения в постах, комментариях и профилях | среды основного клиента | [npm](https://www.npmjs.com/package/@itd-api/crypto) | [README](./packages/crypto/README.md) |
| `@itd-api/proxy` | HTTP/HTTPS- и SOCKS5-транспорт | Node.js 18+, Bun, Deno | [npm](https://www.npmjs.com/package/@itd-api/proxy) | [README](./packages/proxy/README.md) |
| `@itd-api/turnstile` | получение Turnstile-токена в локальном браузере | Node.js 18+, Bun, Deno + Playwright | [npm](https://www.npmjs.com/package/@itd-api/turnstile) | [README](./packages/turnstile/README.md) |

## Документация

| Раздел | Содержание |
|---|---|
| [Быстрый старт](./guides/quickstart/README.md) | создание клиента, чтение и публикация, пагинация, ошибки |
| [Авторизация](./guides/authentication/README.md) | токены, Turnstile, OTP, refresh и хранение сессии |
| [Конфигурация](./guides/configuration/README.md) | таймауты, повторы, очереди, сервисы, hooks и lifecycle |
| [Несколько аккаунтов](./guides/multi-accounts/README.md) | `ItdAccounts`, общее хранилище и отдельные сессии |
| [Разметка текста](./guides/text-markup/README.md) | spans, автоматическая разметка и отображение |
| [Realtime](./guides/realtime/README.md) | события, SSE, polling и переподключение |
| [Интеграции](./guides/integrations/README.md) | browser proxy и Turnstile |
| [Плагины](./guides/plugins/README.md) | cache, crypto и создание плагина |
| [Справочник API](./guides/reference/README.md) | ресурсы, методы, типы, ошибки и билдеры |

## Совместимость

| Среда | Поддержка |
|---|---|
| Node.js 18+ | полная, включая файловую точку входа `itd-api/node` |
| Bun, Deno | полная |
| Браузер | кроме файловой системы; для основного API нужен server-side proxy из-за CORS |
| React Native | полная; realtime переключается на polling без потокового чтения |

TypeScript 5.0+. Пакет проверяется в Node.js 18, 20, 22, 24 и 26, а корректность
публикации — через `publint` и `@arethetypeswrong/cli`.

## Сеть и доверие

По умолчанию основной пакет обращается ровно к двум хостам:

| Хост | Назначение | Автоматическая передача Bearer-токена |
|---|---|---|
| `https://xn--d1ah4a.com` (`итд.com`) | REST API, авторизация и realtime | да, для защищённых REST-методов и realtime |
| `https://xn--80a7abcbg.xn--d1ah4a.com` (`статус.итд.com`) | публичное состояние сервисов | нет |

Опциональный `@itd-api/turnstile` дополнительно загружает виджет с
`https://challenges.cloudflare.com`; пакет не передаёт пароль странице браузера.
`@itd-api/cache` и `@itd-api/crypto` сами не создают сетевые запросы, а
`@itd-api/proxy` использует только адрес proxy, заданный пользователем.

Пользовательские настройки меняют границу доверия:

| Настройка | Последствие |
|---|---|
| `baseUrl` | становится основным API-хостом; на него идут авторизация, сессия, защищённые запросы и realtime |
| `fetch` | получает URL, заголовки и body всех запросов клиента; передавайте только доверенную реализацию |
| `proxyFetch(...)` | направляет запросы через указанный вами proxy, которому будут доступны соединения с API |
| `defineService({ auth: true })` | явно разрешает отправлять Bearer-токен на хост этого сервиса |
| `request({ baseUrl })` | внешний хост не получает Bearer автоматически; `skipAuth: false` явно разрешает его передачу |

Уязвимости следует отправлять приватно по
[политике безопасности](./.github/SECURITY.md).

## Известные ограничения платформы

| Ограничение | Что учитывать |
|---|---|
| CORS основного API | браузерному приложению нужен собственный серверный proxy; [подробнее](./guides/integrations/README.md#браузер-и-cors) |
| Подписчики, подписки и блокировки | сервер возвращает только первые 20 записей; [подробнее](./guides/reference/users.md) |
| Посты пользователя | `posts.byUser()` возвращает стену, включая чужие публикации на ней; [подробнее](./guides/reference/posts.md) |
| Rate limiting | лимиты различаются по endpoint, а сервер не сообщает время сброса окна; [настройка очереди](./guides/configuration/README.md#очередь-и-rate-limiting) |

Матрица известных маршрутов, wire-контрактов и статуса поддержки находится в
[справочнике endpoint](./guides/reference/endpoints.md).

## Проект

- [CI](https://github.com/KiowDev/itd-api/actions/workflows/ci.yml)
- [История релизов](https://github.com/KiowDev/itd-api/releases)
- [Как внести вклад](./.github/CONTRIBUTING.md)
- [Политика безопасности](./.github/SECURITY.md)
- [MIT License](./LICENSE) и [NOTICE](./NOTICE)

Публикация `itd-api@0.1.0` содержит проверяемое
[npm provenance](https://registry.npmjs.org/-/npm/v1/attestations/itd-api@0.1.0).

## Лицензия

MIT © Kiow. Проект использует независимо восстановленные сведения о публичном
интерфейсе платформы; товарные знаки и сама платформа принадлежат их владельцам.
