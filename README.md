<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/KiowDev/itd-api/main/guides/web/public/logos/itd-api-logo-horizontal-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/KiowDev/itd-api/main/guides/web/public/logos/itd-api-logo-horizontal.svg">
    <img alt="itd-api" src="https://raw.githubusercontent.com/KiowDev/itd-api/main/guides/web/public/logos/itd-api-logo-horizontal.svg">
  </picture>
</div>

# SDK для работы с API ИТД

[![npm version](https://img.shields.io/npm/v/itd-api.svg)](https://www.npmjs.com/package/itd-api)
[![npm downloads](https://img.shields.io/npm/dm/itd-api.svg)](https://www.npmjs.com/package/itd-api)
[![CI](https://github.com/KiowDev/itd-api/actions/workflows/ci.yml/badge.svg)](https://github.com/KiowDev/itd-api/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/node/v/itd-api.svg)](https://www.npmjs.com/package/itd-api)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0%2B-3178c6.svg)](./tsconfig.json)
[![license](https://img.shields.io/npm/l/itd-api.svg)](./LICENSE)

JavaScript/TypeScript SDK для социальной сети **итд.com**: авторизация, работа с
пользователями и публикациями, события, пагинация и расширения через плагины.
Проект не является официальным и не аффилирован с итд.com.

[Документация](https://kiowdev.github.io/itd-api/) ·
[Быстрый старт](https://kiowdev.github.io/itd-api/quickstart/) ·
[Руководства](https://kiowdev.github.io/itd-api/guides/) ·
[Справочник API](https://kiowdev.github.io/itd-api/reference/) ·
[Совместимость](#совместимость) ·
[Сеть и доверие](#сеть-и-доверие) ·
[Пакеты проекта](#пакеты-проекта) ·
[Демо](https://itd-api-demo.vercel.app/)

## Требования

Для Node.js требуется версия 18+. Поддерживаются JavaScript, TypeScript 5.0+,
ESM и CommonJS; остальные среды перечислены в разделе [«Совместимость»](#совместимость).

## Установка

```bash
npm install itd-api
```

## Быстрый старт

Получите access token по [руководству по авторизации](https://kiowdev.github.io/itd-api/authentication/)
и сохраните его в переменной окружения `ITD_ACCESS_TOKEN`.

> [!WARNING]
> Не храните access token в исходном коде и не публикуйте его в репозитории.

Создайте файл `index.js` и запросите посты со стены пользователя:

```js
const { ItdClient } = require('itd-api');

async function main() {
  const accessToken = process.env.ITD_ACCESS_TOKEN;
  if (!accessToken) {
    throw new Error('Переменная окружения ITD_ACCESS_TOKEN не задана');
  }

  const itd = new ItdClient({ auth: accessToken });
  const page = await itd.posts.byUser('nowkie', { limit: 10 });

  for (const post of page.items) {
    console.log(post.author.username, post.content);
  }
}

main().catch(console.error);
```

Запустите его командой `node index.js`.

В TypeScript или JavaScript с ES modules используйте ESM-импорт:

```ts
import { ItdClient } from 'itd-api';
```

Для долгоживущего приложения восстановите сохранённую сессию или настройте вход
по руководству по авторизации.

## Возможности

| Область | Что поддерживается |
|---|---|
| REST API | пользователи, посты, комментарии, файлы, уведомления, поиск, жалобы, верификация, подписка и магазин |
| Авторизация | access/refresh token, автоматическое обновление, OTP, хранение сессии и несколько аккаунтов |
| События | SSE и резервный опрос, промежуточные обработчики, типизированные фильтры и маршрутизация |
| Пагинация | разные серверные схемы через единый `for await` |
| Публикация | билдеры постов, комментариев, опросов, разметки текста и загрузки файлов |
| Надёжность | таймауты, отмена, очередь, ограничения частоты, безопасные повторы, хуки и типизированные ошибки |
| Расширение | плагины, собственный `fetch`, сервисы и произвольные запросы |
| Платформа | версии приложений, changelog, анонсы, портал и состояние сервисов |

У основного пакета нет runtime-зависимостей. Он поставляется как ESM и CommonJS с
полными TypeScript-типами.

## Пакеты проекта

Все пакеты в таблице поддерживаются проектом itd-api.

| Пакет | Назначение | Среда | npm | Документация |
|---|---|---|---|---|
| `itd-api` | полный SDK для итд.com | Node.js 18+, браузер, Bun, Deno, React Native | [npm](https://www.npmjs.com/package/itd-api) | [быстрый старт](https://kiowdev.github.io/itd-api/quickstart/) |
| `@itd-api/captcha` | получение токена капчи (ИТД и Turnstile) в локальном браузере | Node.js 18+, Bun, Deno + драйвер браузера | [npm](https://www.npmjs.com/package/@itd-api/captcha) | [документация](https://kiowdev.github.io/itd-api/packages/captcha) |
| `@itd-api/proxy` | прокси-транспорт для HTTP и WebSocket | Node.js 18+, Bun, Deno | [npm](https://www.npmjs.com/package/@itd-api/proxy) | [документация](https://kiowdev.github.io/itd-api/packages/proxy) |
| `@itd-api/cache` | TTL/LRU-кэш и дедупликация запросов | среды основного клиента | [npm](https://www.npmjs.com/package/@itd-api/cache) | [документация](https://kiowdev.github.io/itd-api/packages/cache) |
| `@itd-api/hydrate` | методы действий на моделях API | среды основного клиента | [npm](https://www.npmjs.com/package/@itd-api/hydrate) | [документация](https://kiowdev.github.io/itd-api/packages/hydrate) |
| `@itd-api/crypto` | скрытые сообщения в постах, комментариях и профилях | среды основного клиента | [npm](https://www.npmjs.com/package/@itd-api/crypto) | [документация](https://kiowdev.github.io/itd-api/packages/crypto) |
| `@itd-api/testing` | сценарные ответы и сервер API в памяти | среды основного клиента | [npm](https://www.npmjs.com/package/@itd-api/testing) | [документация](https://kiowdev.github.io/itd-api/packages/testing) |

## Документация

| Раздел | Содержание |
|---|---|
| [Быстрый старт](https://kiowdev.github.io/itd-api/quickstart/) | создание клиента, чтение и публикация, пагинация, ошибки |
| [Авторизация](https://kiowdev.github.io/itd-api/authentication/) | токены, капча, OTP, refresh и хранение сессии |
| [Конфигурация](https://kiowdev.github.io/itd-api/configuration/) | таймауты, повторы, очереди, сервисы, хуки и жизненный цикл |
| [Несколько аккаунтов](https://kiowdev.github.io/itd-api/multi-accounts/) | `ItdAccounts`, общее хранилище и отдельные сессии |
| [Разметка текста](https://kiowdev.github.io/itd-api/text-markup/) | spans, автоматическая разметка и отображение |
| [События](https://kiowdev.github.io/itd-api/events/) | обновления, обработчики, фильтры, маршрутизация и переподключение |
| [Интеграции](https://kiowdev.github.io/itd-api/integrations/) | прокси и автоматическое получение токенов капчи |
| [Плагины](https://kiowdev.github.io/itd-api/plugins/) | cache, crypto и создание плагина |
| [Справочник API](https://kiowdev.github.io/itd-api/reference/) | ресурсы, методы, типы, ошибки и билдеры |

## Совместимость

| Среда | Поддержка |
|---|---|
| Node.js 18+ | полная, включая файловую точку входа `itd-api/node` |
| Bun, Deno | полная |
| Браузер | кроме файловой системы; хранилище сессии — `itd-api/web`; для основного API нужен серверный прокси из-за CORS |
| React Native | полная; поток переключается на периодический опрос без потокового чтения |

TypeScript 5.0+. Пакет проверяется в Node.js 18, 20, 22, 24 и 26, а корректность
публикации — через `publint` и `@arethetypeswrong/cli`.

## Сеть и доверие

По умолчанию SDK соединяется только с API итд.com и публичным сервисом статуса.
Bearer-токен автоматически передаётся только основному API.

<details>
<summary>Подробности о сетевых подключениях и передаче токена</summary>

Основной пакет обращается к двум хостам:

| Хост | Назначение | Автоматическая передача Bearer-токена |
|---|---|---|
| `https://xn--d1ah4a.com` (`итд.com`) | REST API, авторизация и события | да, для защищённых REST-методов и событий |
| `https://xn--80a7abcbg.xn--d1ah4a.com` (`статус.итд.com`) | публичное состояние сервисов | нет |

Опциональный `@itd-api/captcha` дополнительно загружает виджет капчи —
с `https://captcha.xn--d1ah4a.com` (ИТД) или `https://challenges.cloudflare.com`
(Turnstile); пакет не передаёт пароль странице браузера.
`@itd-api/cache` и `@itd-api/crypto` сами не создают сетевые запросы, а
`@itd-api/proxy` использует только адрес прокси, заданный пользователем.

Пользовательские настройки меняют границу доверия:

| Настройка | Последствие |
|---|---|
| `baseUrl` | становится основным API-хостом; на него идут авторизация, сессия, защищённые запросы и события |
| `fetch` | получает URL, заголовки и тело всех запросов клиента; передавайте только доверенную реализацию |
| `proxyFetch(...)` | направляет запросы через указанный вами прокси, которому будут доступны соединения с API |
| `defineService({ auth: true })` | явно разрешает отправлять Bearer-токен на хост этого сервиса |
| `request({ baseUrl })` | внешний хост не получает Bearer автоматически; `skipAuth: false` явно разрешает его передачу |

</details>

Уязвимости следует отправлять приватно по
[политике безопасности](./.github/SECURITY.md).

## Известные ограничения платформы

Ограничения зависят от маршрута и среды выполнения. Полная матрица известных
маршрутов, протоколов и статуса поддержки находится в
[справочнике методов API](https://kiowdev.github.io/itd-api/reference/endpoints).

<details>
<summary>Показать известные ограничения</summary>

| Ограничение | Что учитывать                                                                                                                                                   |
|---|-----------------------------------------------------------------------------------------------------------------------------------------------------------------|
| CORS основного API | браузерному приложению нужен собственный серверный proxy; [подробнее](https://kiowdev.github.io/itd-api/integrations/#браузер-и-cors)                           |
| Подписчики, подписки и блокировки | сервер возвращает только первые 20 записей; [подробнее](https://kiowdev.github.io/itd-api/reference/users)                                                      |
| Посты пользователя | `posts.byUser()` возвращает стену, включая чужие публикации на ней; [подробнее](https://kiowdev.github.io/itd-api/reference/posts)                              |
| Ограничения частоты | маршруты разбиты на бакеты, у каждого свой лимит запросов в минуту, считается по IP; [таблица бакетов](https://kiowdev.github.io/itd-api/reference/rate-limits) |

</details>

## Проект

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/KiowDev/itd-api)

- [CI](https://github.com/KiowDev/itd-api/actions/workflows/ci.yml)
- [История релизов](https://github.com/KiowDev/itd-api/releases)
- [Как внести вклад](./.github/CONTRIBUTING.md)
- [Политика безопасности](./.github/SECURITY.md)
- [MIT License](./LICENSE) и [NOTICE](./NOTICE)

Пакет публикуется через npm Trusted Publishing с проверяемым
[provenance](https://www.npmjs.com/package/itd-api).

## Лицензия

MIT © Kiow. Проект использует независимо восстановленные сведения о публичном
интерфейсе платформы; товарные знаки и сама платформа принадлежат их владельцам.
