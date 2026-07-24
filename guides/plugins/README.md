# Плагины

Плагин расширяет клиент обёртками вокруг запросов и ответов. Одна установка действует на
все ресурсы:

```ts
import { ItdClient } from 'itd-api';
import { crypt } from '@itd-api/crypto';

const itd = new ItdClient({ auth: token });
itd.use(crypt());
```

## Cache

```bash
npm install @itd-api/cache
```

```ts
import { cache } from '@itd-api/cache';

const cached = cache({
  ttl: 60_000,
  routes: ['users.get', 'posts.get', 'posts.list'],
});

itd.use(cached);
```

Плагин хранит успешные ответы в LRU-кэше и объединяет одновременные одинаковые запросы.
Маршруты выбираются явно; после мутаций связанные данные инвалидируются автоматически.
У каждого клиента и аккаунта свой раздел кэша, а изменения общих сущностей сбрасывают
соответствующие маршруты во всех разделах.

```ts
await itd.posts.get(postId, { cache: 'reload' });
cached.invalidate('posts.get');
```

Полный каталог маршрутов, подключение к нескольким клиентам и привязка к realtime описаны в
[README пакета](../../cache/README.md).

Запускаемый пример:

```bash
ITD_TOKEN=<accessToken> ITD_POST_ID=<postId> \
  node guides/plugins/examples/cache.mjs
```

## Crypto

```bash
npm install @itd-api/crypto
```

```ts
import { crypt } from '@itd-api/crypto';

itd.use(crypt());

const created = await itd.posts.create(
  { content: 'секретный текст' },
  { encrypt: { cipher: 'invisible', cover: 'обычный пост' } },
);

const post = await itd.posts.get(created.id);
console.log(post.content);      // обложка
console.log(post.secret?.text); // секретный текст
```

Плагин обрабатывает посты, комментарии, ответы и текстовые поля профиля. Доступны
`invisible` и `beecrypt`; подробные ограничения описаны в README пакета.

Запускаемый пример:

```bash
ITD_TOKEN=<accessToken> node guides/plugins/examples/crypto.mjs
```

## Собственный плагин

```ts
import type { ItdPlugin } from 'itd-api';

const timing: ItdPlugin = {
  name: 'timing',
  install({ use, logger }) {
    use(async (request, next) => {
      const started = Date.now();
      try {
        return await next(request);
      } finally {
        logger?.info(`${request.method} ${request.path}: ${Date.now() - started} мс`);
      }
    });
  },
};

itd.use(timing);
```

Обёртка может:

- передать в `next()` изменённую копию запроса;
- изменить полученный ответ;
- вернуть результат без обращения к сети;
- выбросить собственную ошибку.

Подключённая раньше обёртка оказывается снаружи. Она выполняется один раз на логический
запрос, независимо от внутренних повторов транспорта.

## Собственные опции метода

Плагин объявляет разрешённые ключи:

```ts
const plugin: ItdPlugin = {
  name: 'мой',
  optionKeys: ['мояОпция'],
  install({ use }) {
    use(async (request, next) => {
      console.log(request.мояОпция);
      return next(request);
    });
  },
};

declare module 'itd-api' {
  interface RequestOptions {
    мояОпция?: string | undefined;
  }
}
```

Ключи самого запроса — `path`, `body`, `headers`, `signal` и другие системные поля —
зарезервированы. Плагин с конфликтующим `optionKeys` отклоняется при подключении.

## Несколько аккаунтов

```ts
accounts.use(plugin);
```

Плагин установится всем существующим аккаунтам и будет автоматически применяться к новым.

## Структура нового плагина

Структура пакета плагина:

```text
my-plugin/
├── package.json
├── README.md
├── src/
│   └── index.ts
└── test/
    └── plugin.test.ts
```

Пакет должен иметь собственные тесты, сборку и экспортировать фабрику либо объект,
совместимый с `ItdPlugin`.
