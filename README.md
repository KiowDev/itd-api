<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/KiowDev/itd-api/main/guides/web/public/logos/itd-api-logo-horizontal-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/KiowDev/itd-api/main/guides/web/public/logos/itd-api-logo-horizontal.svg">
    <img alt="itd-api" src="https://raw.githubusercontent.com/KiowDev/itd-api/main/guides/web/public/logos/itd-api-logo-horizontal.svg" width="560">
  </picture>
</p>

# itd-api

[![npm version](https://img.shields.io/npm/v/itd-api.svg)](https://www.npmjs.com/package/itd-api)
[![npm downloads](https://img.shields.io/npm/dm/itd-api.svg)](https://www.npmjs.com/package/itd-api)
[![CI](https://github.com/KiowDev/itd-api/actions/workflows/ci.yml/badge.svg)](https://github.com/KiowDev/itd-api/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/node/v/itd-api.svg)](https://www.npmjs.com/package/itd-api)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0%2B-3178c6.svg)](./tsconfig.json)
[![license](https://img.shields.io/npm/l/itd-api.svg)](./LICENSE)

Независимый TypeScript-клиент REST и realtime API социальной сети **итд.com**.
Проект не является официальным SDK и не аффилирован с итд.com.

[Документация](https://kiowdev.github.io/itd-api/) ·
[Быстрый старт](https://kiowdev.github.io/itd-api/quickstart/) ·
[Руководства](https://kiowdev.github.io/itd-api/guides/) ·
[Справочник API](https://kiowdev.github.io/itd-api/reference/) ·
[Совместимость](#совместимость) ·
[Сеть и доверие](#сеть-и-доверие) ·
[Пакеты проекта](#пакеты-проекта)

## Установка

```bash
npm install itd-api
```

Передайте access token и запросите посты со стены пользователя:

```ts
import { ItdClient } from 'itd-api';

const itd = new ItdClient({ auth: '<accessToken>' });
const page = await itd.posts.byUser('nowkie', { limit: 10 });

for (const post of page.items) {
  console.log(post.author.username, post.content);
}
```

Для долгоживущего приложения восстановите сохранённую сессию или настройте вход по
[руководству по авторизации](https://kiowdev.github.io/itd-api/authentication/).

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
| `itd-api` | REST/realtime-клиент | Node.js 18+, браузер, Bun, Deno, React Native | [npm](https://www.npmjs.com/package/itd-api) | [быстрый старт](https://kiowdev.github.io/itd-api/quickstart/) |
| `@itd-api/cache` | TTL/LRU-кэш и дедупликация запросов | среды основного клиента | [npm](https://www.npmjs.com/package/@itd-api/cache) | [документация](https://kiowdev.github.io/itd-api/packages/cache) |
| `@itd-api/crypto` | скрытые сообщения в постах, комментариях и профилях | среды основного клиента | [npm](https://www.npmjs.com/package/@itd-api/crypto) | [документация](https://kiowdev.github.io/itd-api/packages/crypto) |
| `@itd-api/proxy` | HTTP/HTTPS- и SOCKS5-транспорт | Node.js 18+, Bun, Deno | [npm](https://www.npmjs.com/package/@itd-api/proxy) | [документация](https://kiowdev.github.io/itd-api/packages/proxy) |
| `@itd-api/turnstile` | получение Turnstile-токена в локальном браузере | Node.js 18+, Bun, Deno + Playwright | [npm](https://www.npmjs.com/package/@itd-api/turnstile) | [документация](https://kiowdev.github.io/itd-api/packages/turnstile) |

## Документация

| Раздел | Содержание |
|---|---|
| [Быстрый старт](https://kiowdev.github.io/itd-api/quickstart/) | создание клиента, чтение и публикация, пагинация, ошибки |
| [Авторизация](https://kiowdev.github.io/itd-api/authentication/) | токены, Turnstile, OTP, refresh и хранение сессии |
| [Конфигурация](https://kiowdev.github.io/itd-api/configuration/) | таймауты, повторы, очереди, сервисы, hooks и lifecycle |
| [Несколько аккаунтов](https://kiowdev.github.io/itd-api/multi-accounts/) | `ItdAccounts`, общее хранилище и отдельные сессии |
| [Разметка текста](https://kiowdev.github.io/itd-api/text-markup/) | spans, автоматическая разметка и отображение |
| [Realtime](https://kiowdev.github.io/itd-api/realtime/) | события, SSE, polling и переподключение |
| [Интеграции](https://kiowdev.github.io/itd-api/integrations/) | browser proxy и Turnstile |
| [Плагины](https://kiowdev.github.io/itd-api/plugins/) | cache, crypto и создание плагина |
| [Справочник API](https://kiowdev.github.io/itd-api/reference/) | ресурсы, методы, типы, ошибки и билдеры |

## Совместимость

| Среда | Поддержка |
|---|---|
| Node.js 18+ | полная, включая файловую точку входа `itd-api/node` |
| Bun, Deno | полная |
| Браузер | кроме файловой системы; хранилище сессии — `itd-api/web`; для основного API нужен server-side proxy из-за CORS |
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
| CORS основного API | браузерному приложению нужен собственный серверный proxy; [подробнее](https://kiowdev.github.io/itd-api/integrations/#браузер-и-cors) |
| Подписчики, подписки и блокировки | сервер возвращает только первые 20 записей; [подробнее](https://kiowdev.github.io/itd-api/reference/users) |
| Посты пользователя | `posts.byUser()` возвращает стену, включая чужие публикации на ней; [подробнее](https://kiowdev.github.io/itd-api/reference/posts) |
| Rate limiting | лимиты различаются по endpoint, а сервер не сообщает время сброса окна; [настройка очереди](https://kiowdev.github.io/itd-api/configuration/#очередь-и-rate-limiting) |

Матрица известных маршрутов, wire-контрактов и статуса поддержки находится в
[справочнике endpoint](https://kiowdev.github.io/itd-api/reference/endpoints).

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
