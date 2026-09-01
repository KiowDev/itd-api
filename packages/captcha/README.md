# @itd-api/captcha

Получает токены собственной капчи ИТД и Cloudflare Turnstile для входа через [`itd-api`](https://github.com/KiowDev/itd-api). Активного провайдера выбирает сервер.

[Руководство](https://kiowdev.github.io/itd-api/packages/captcha) ·
[API из TSDoc](https://kiowdev.github.io/itd-api/api/generated/captcha/)

Пакет запускает браузер, решает виджет выбранного типа, возвращает токен и закрывает браузер.

## Когда пакет не нужен

Капча участвует только в самом входе по паролю — ни продление сессии, ни обычные запросы,
ни событийные соединения её не требуют. Пакет незачем ставить, если:

- сессия уже сохранена в `FileTokenStorage` — клиент продлевает её сам;
- токены можно [скопировать из браузера](https://kiowdev.github.io/itd-api/authentication/#токены-из-браузера), где вы уже вошли: DevTools отдают и access token, и cookie `refresh_token`;
- access token выдаёт серверное приложение или хранилище секретов — тогда подойдёт `auth: { getToken }`;
- токен капчи приходит из своего источника — `auth.captcha.getToken` принимает любую функцию.

## Установка

```sh
npm i @itd-api/captcha patchright
npx patchright install chromium
```

Драйвер подключается динамически, в порядке `patchright` → `playwright` → `playwright-core`:
что из этого установлено, то и берётся. Все три — необязательные одноранговые зависимости,
достаточно любой одной. Любой другой совместимый по API драйвер передаётся через `launch`.
Какие связки сейчас выдают токен — в разделе [Совместимость](#совместимость).

## Использование

```ts
import { ItdClient } from 'itd-api';
import { FileTokenStorage } from 'itd-api/node';
import { createCaptchaSolver } from '@itd-api/captcha';

const itd = new ItdClient({
  storage: new FileTokenStorage('./.itd-session.json'),
  auth: {
    email: process.env.ITD_EMAIL!,
    password: process.env.ITD_PASSWORD!,
    captcha: createCaptchaSolver(),
  },
});
```

`createCaptchaSolver()` отдаёт `getToken(type)`. Перед каждым входом клиент читает активного
провайдера и просит решить именно его виджет, поэтому переключение провайдера сервером
переживается без правок кода. Передаётся функция, а не готовый токен: токен одноразовый и
живёт несколько минут. Браузер поднимается на время одного вызова и сразу закрывается.

Решить капчу без клиента — тип называется явно:

```ts
import { solveCaptcha, CaptchaType } from '@itd-api/captcha';

const token = await solveCaptcha(CaptchaType.Itd);
```

Провайдера с другими настройками собирает его фабрика:

```ts
import { solveCaptcha, itdCaptcha, turnstile } from '@itd-api/captcha';

const forRegistration = await solveCaptcha(itdCaptcha({ action: 'register' }));
const withOwnKey = await solveCaptcha(turnstile({ sitekey: '0x…' }), { headless: true });
```

## Свой провайдер

Новый виджет добавляется реализацией `CaptchaHandler` — менять пакет не нужно. Перехват
навигации, ожидание, клик по чекбоксу и повторы одинаковы для всех виджетов и уже сделаны;
описать нужно только то, чем виджет отличается:

```ts
import { solveCaptcha, type CaptchaHandler } from '@itd-api/captcha';

const myCaptcha: CaptchaHandler = {
  type: 'my-captcha',
  label: 'моей капчи',
  // Страница отдаётся вместо настоящей по адресу из `origin`, поэтому виджет видит верный домен.
  buildPage: ({ theme }) => `<!doctype html>…<div id="widget" data-theme="${theme}"></div>…`,
  // По этому селектору видно, что виджет отрисовался.
  widgetReadySelector: '#widget',
  // Насколько правее левого края контейнера чекбокс: клик идёт по координатам.
  checkboxOffsetX: 30,
  readState: (page) =>
    page.evaluate(() => {
      const field = document.querySelector('#my-token') as { value?: string } | null;
      return { token: field?.value || null, error: null };
    }),
  // Повтор не поможет — например, ключ не разрешён для домена.
  isPermanentWidgetError: (code) => code === 'domain-mismatch',
};

const token = await solveCaptcha(myCaptcha);
```

Такой обработчик подставляется и в клиент: `captcha: { type: 'my-captcha', getToken: () =>
solveCaptcha(myCaptcha), field: 'myToken' }`.

## Запуск на сервере

**Браузер по умолчанию запускается с окном.** В безоконном режиме виджет проходится заметно
хуже: признаки такого режима видны странице. На сервере без графической оболочки поднимите
виртуальный дисплей — это надёжнее, чем `headless: true`:

```sh
apt install xvfb
xvfb-run -a node bot.js
```

В Docker к образу нужны системные библиотеки браузера: `npx patchright install --with-deps chromium`.

## Как это устроено

Пакет **не заходит на сайт**. Навигация на `https://xn--d1ah4a.com/` перехватывается и вместо
настоящей страницы отдаётся своя — с одним виджетом. Домен остаётся настоящим, поэтому
привязка ключа не нарушается, а сервер видит ожидаемое имя хоста.

Из этого следует остальное:

- **пароль в браузер не попадает** — форма входа не участвует, вход выполняет сам `itd-api`;
- ничего не ломается от изменений вёрстки сайта: важен только публичный ключ виджета;
- нет гонки с настоящим запросом входа, а значит и незачем его подвешивать.

Чекбокс живёт в iframe чужого происхождения, до его DOM не дотянуться — клик идёт по
координатам. Отсчёт ведётся от собственного контейнера известного размера, поэтому попадание
не зависит от чужой вёрстки. Координаты слегка разбрасываются, первому касанию предшествует
пауза, а `User-Agent` не подменяется: заявленная версия, разошедшаяся с реальным движком,
сама по себе служит признаком автоматизации.

Капча ИТД оценивает и поведение указателя, поэтому клик идёт настоящей мышью браузера (через
CDP), а не программной установкой значения, — то же движение курсора, что и у человека.

## Настройки

Все необязательны.

| Параметр | По умолчанию | Что делает |
| --- | --- | --- |
| `headless` | `false` | Запуск без окна. См. раздел про сервер. |
| `disableSandbox` | `false` | Отключить sandbox Chromium; только для изолированного контейнера. |
| `timeout` | `60000` | Сколько ждать токен, мс. |
| `attempts` | `2` | Сколько попыток при таймауте. |
| `theme` | `'auto'` | Оформление виджета. |
| `origin` | `https://xn--d1ah4a.com` | Сайт, чей виджет решается. |
| `driver` | перебор | Какой драйвер брать, когда установлено несколько. |
| `executablePath` | — | Путь к браузеру, если он лежит не там, где его ищет драйвер. |
| `channel` | — | Канал браузера, например `chrome`, вместо сборки из комплекта драйвера. |
| `args` | — | Дополнительные аргументы командной строки. |
| `proxy` | — | Прокси для браузера. |
| `browser` | — | Готовый браузер. Тогда пакет его не запускает и не закрывает. |
| `launch` | — | Свой запуск браузера. Заменяет все параметры запуска. |
| `contextOptions` | `locale: 'ru-RU'`, окно 1280×800 | Настройки контекста. Заменяют стандартные целиком. |
| `logger` | — | Функция для вывода хода решения, например `console.debug`. |

Ключ, назначение токена и адрес виджета — настройки конкретного провайдера, поэтому задаются
в его фабрике:

| Фабрика | Параметр | По умолчанию | Что делает |
| --- | --- | --- | --- |
| `itdCaptcha` | `sitekey` | ключ итд.com | Публичный ключ виджета. |
| `itdCaptcha` | `action` | `'login'` | Назначение токена: `login`, `register`, `password_reset`. |
| `itdCaptcha` | `captchaOrigin` | `https://captcha.xn--d1ah4a.com` | Базовый адрес виджета. |
| `turnstile` | `sitekey` | ключ итд.com | Публичный ключ виджета. |

```ts
await solveCaptcha(itdCaptcha({ action: 'password_reset' }), { timeout: 90_000 });
```

Свой драйвер:

```ts
createCaptchaSolver({
  launch: async () => {
    const { chromium } = await import('patchright');
    return chromium.launch({ headless: false });
  },
});
```

Драйверу, который собирает отпечаток браузера сам, контекст лучше отдать целиком:

```ts
createCaptchaSolver({
  contextOptions: {},
  launch: async () => {
    const { Camoufox } = await import('camoufox-js');
    return Camoufox({ headless: false, humanize: true });
  },
});
```

## Ошибки

Всё, что пошло не так, приходит как `CaptchaError` с полем `reason` (и `type`, когда виджет
уже выбран):

| `reason` | Что делать |
| --- | --- |
| `driver-missing` | Установить `patchright` либо передать свой `launch`. |
| `launch-failed` | Браузер не запустился: нет исполняемого файла или дисплея. |
| `browser-closed` | Окно закрыли или процесс браузера завершился до получения токена. |
| `timeout` | Виджет не отдал токен. Обычно лечится повтором. |
| `widget-error` | Виджет отказал; для Cloudflare код лежит в `widgetCode`. |

Код `110200` в `widgetCode` означает, что ключ Turnstile не разрешён для указанного домена, —
повторять бессмысленно, и пакет этого не делает.

## Совместимость

Виджет пропускает не всякий браузер. Таблица пересобирается скриптом `scripts/drivers.mjs`
из исходников пакета:

```sh
npm i --no-save patchright playwright camoufox-js
node scripts/drivers.mjs            # Turnstile
node scripts/drivers.mjs --itd      # капча ИТД
```

Всё, что удаётся получить с окном; `headless: true` токена почти нигде не даёт. Сборка
приезжает вместе с версией драйвера, ею и выбирается — `npm i playwright@1.61`. Поставленная
отдельно тоже годится: `npx @puppeteer/browsers install chrome@149.0.7827.55` и путь
в `executablePath`. Версию запущенного браузера пакет называет в сообщении о таймауте.

## Лицензия

MIT
