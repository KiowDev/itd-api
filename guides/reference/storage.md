# Сессии и хранилища

Хранилище позволяет пережить перезапуск приложения без нового входа. Клиент читает и
записывает сессию через `TokenStorage`; `ItdAccounts` использует `MultiTokenStorage`.
Практический сценарий разобран в [руководстве по авторизации](../authentication/).

> [!WARNING]
> Сессия содержит токены и cookie. Не коммитьте файлы сессий, не печатайте их в логах и
> выбирайте хранилище с подходящей вашему приложению моделью доступа.

## Общий key-value backend

Интеграция с Redis, БД, `localStorage` или другой системой начинается с минимального
контракта, не зависящего от сессий:

```ts
interface KeyValueStore<T> {
  get(key: string): T | undefined | Promise<T | undefined>;
  set(key: string, value: T): void | Promise<void>;
  delete(key: string): void | Promise<void>;
  keys?(prefix?: string):
    | Iterable<string>
    | AsyncIterable<string>
    | Promise<Iterable<string> | AsyncIterable<string>>;
}
```

`MemoryKeyValueStore` хранит произвольные значения в памяти. `createKeyValueStore()` проверяет
и типизирует набор функций конкретного backend. Два composable decorator позволяют не
повторять инфраструктурную логику:

- `withNamespace(store, 'my-app')` изолирует ключи префиксом `my-app:`;
- `withCodec(store, codec)` преобразует тип значения, например объект в JSON-строку.

```ts
const raw = createKeyValueStore<string>({
  get: async (key) => (await redis.get(key)) ?? undefined,
  set: (key, value) => redis.set(key, value).then(() => undefined),
  delete: (key) => redis.del(key).then(() => undefined),
  keys: (prefix = '') => redis.scanIterator({ MATCH: `${prefix}*` }),
});

const sessions = withCodec<ItdSession, string>(withNamespace(raw, 'itd'), {
  encode: JSON.stringify,
  decode: JSON.parse,
});
```

`keys()` опционален для одиночного клиента, но обязателен для `MultiTokenStorage`: список
аккаунтов выводится из фактических ключей, поэтому отдельный индекс не может разойтись с данными.

## `ItdSession`

```ts
interface ItdSession {
  accessToken?: string;
  refreshToken?: string;
  cookies?: string[];
  deviceId?: string;
  obtainedAt?: number;
}
```

`deviceId` должен быть стабильным: сервер использует его для различения устройств в
списке сессий. `obtainedAt` — время получения сессии в миллисекундах Unix.

## Хранилище одного клиента

```ts
interface TokenStorage {
  get(): ItdSession | null | Promise<ItdSession | null>;
  set(session: ItdSession): void | Promise<void>;
  clear(): void | Promise<void>;
}
```

| Реализация | Импорт | Поведение |
|---|---|---|
| `MemoryTokenStorage` | `itd-api` | вариант по умолчанию; сессия теряется при завершении процесса |
| `LocalStorageTokenStorage` | `itd-api/web` | браузерный `localStorage`; при недоступности переключается на память |
| `SessionStorageTokenStorage` | `itd-api/web` | браузерный `sessionStorage`; живёт в пределах текущей page session |
| `FileTokenStorage` | `itd-api/node` | JSON-файл для Node.js, Bun и Deno |

```ts
import { ItdClient } from 'itd-api';
import { LocalStorageTokenStorage } from 'itd-api/web';

const storage = new LocalStorageTokenStorage('my-app:itd-session');
const itd = new ItdClient({ storage });
```

`localStorage` доступен любому скрипту на странице. Не используйте его, если риск XSS
или совместный доступ к origin делает такое хранение неприемлемым.

`SessionStorageTokenStorage` имеет тот же контракт и также переживает перезагрузку страницы,
но браузер удаляет его данные после завершения page session. Это уменьшает срок жизни сессии,
но не защищает её от скриптов страницы. Оба Web Storage backend при недоступности API или
ошибке доступа/записи переключают конкретный экземпляр на память. Повреждённый JSON не
считается отсутствующей сессией: `get()` явно выбрасывает `ItdConfigError` с именем backend
и ключом, чтобы повреждение не приводило к молчаливому выходу пользователя.

`TokenStorage` можно реализовать напрямую, но для обычного key-value backend достаточно
доменного адаптера:

```ts
const storage = createTokenStorage(sessions); // использует ключ `session`
```

Методы могут быть синхронными или асинхронными. `get()` должен вернуть `null`, если
сессии нет.

## Файловое хранилище

```ts
import { ItdClient } from 'itd-api';
import { FileTokenStorage } from 'itd-api/node';

const itd = new ItdClient({
  storage: new FileTokenStorage('./.itd-session.json'),
});
```

`FileTokenStorage` записывает через временный файл и атомарное переименование. Файл
создаётся с правами `0600`, где это поддерживается. Операции записи и удаления
выполняются последовательно.

Добавьте путь в `.gitignore`. Отсутствующий файл считается пустым. Повреждённый JSON или
неизвестная версия формата приводят к `ItdConfigError`, чтобы следующая запись не затёрла данные.

## Хранилище нескольких аккаунтов

```ts
interface MultiTokenStorage {
  get(account: string): ItdSession | null | Promise<ItdSession | null>;
  set(account: string, session: ItdSession): void | Promise<void>;
  clear(account: string): void | Promise<void>;
  accounts(): readonly string[] | Promise<readonly string[]>;
}
```

Имя аккаунта приходит без нормализации. Адаптер сам отвечает за экранирование,
префиксы и ограничения ключей.

| Реализация | Импорт | Поведение |
|---|---|---|
| `MemoryMultiTokenStorage` | `itd-api` | вариант `ItdAccounts` по умолчанию |
| `FileMultiTokenStorage` | `itd-api/node` | все аккаунты в одном версионированном JSON-файле |

```ts
import { ItdAccounts } from 'itd-api';
import { FileMultiTokenStorage } from 'itd-api/node';

const accounts = new ItdAccounts({
  storage: new FileMultiTokenStorage('./.itd-sessions.json'),
});

await accounts.restore();
```

Для Redis, БД или другого enumerable key-value backend:

```ts
const storage = createMultiTokenStorage(sessions);
```

Сессии записываются под ключами `accounts/<encoded-name>`. `accounts()` перечисляет этот
префикс и восстанавливает исходные имена, по которым `restore()` поднимает аккаунты. Ключ,
который не декодируется, пропускается с предупреждением: чужая запись в том же пространстве
имён не должна лишать восстановления остальные аккаунты.

## Хранилище одной общей записью

`createRecordKeyValueStore()` подходит, когда источник читает и пишет всю карту значений:

```ts
interface RecordKeyValueStoreSource<T> {
  read(): Record<string, T> | undefined | Promise<Record<string, T> | undefined>;
  write(record: Readonly<Record<string, T>>): void | Promise<void>;
  delete?(): void | Promise<void>;
}

const backend = createRecordKeyValueStore<ItdSession>(source);
const storage = createMultiTokenStorage(backend);
```

Адаптер один раз загружает слепок и выстраивает изменения в последовательную очередь,
предотвращая гонку «прочитать — изменить — записать» внутри экземпляра. Несколько
процессов или несколько адаптеров для одного источника требуют внешней синхронизации.

Изменение становится видимым чтениям только после того, как его подтвердит `write()`:
неудачная запись не оставляет следа ни в источнике, ни в слепке. Поэтому `set()` и `delete()`
нужно дожидаться — читать сразу после незавершённой записи бессмысленно.

`scopedTokenStorage(storage, account)` создаёт из `MultiTokenStorage` обычный
`TokenStorage`, привязанный к одному имени.

## Точки входа

Клиент, аккаунты, билдеры, типы и всё остальное живут в `itd-api` и одинаковы на всех
платформах. В подточку вынесено только то, что нельзя положить в нейтральный бандл:

| Точка входа | Что в ней | Почему отдельно |
|---|---|---|
| `itd-api` | `KeyValueStore`, memory backend, decorators, доменные storage | — |
| `itd-api/node` | `FileKeyValueStore`, файловые domain storage, `fromPath` | требует `node:fs`, который браузерные сборщики не разрешают |
| `itd-api/web` | generic и token storage для `localStorage` и `sessionStorage` | молчаливый откат в память стоит выбирать осознанно |

```ts
import { ItdAccounts, ItdClient } from 'itd-api';
import { FileKeyValueStore, FileMultiTokenStorage, FileTokenStorage, fromPath } from 'itd-api/node';
import {
  LocalStorageKeyValueStore,
  LocalStorageTokenStorage,
  SessionStorageKeyValueStore,
  SessionStorageTokenStorage,
} from 'itd-api/web';
```

Платформенные точки входа не переэкспортируют основной API. `ItdClient` импортируется
из `itd-api`.

## Связанные разделы

- [Авторизация и сессии](../authentication/)
- [Несколько аккаунтов](../multi-accounts/)
- [Файлы](./files.md)
- [Клиент](./client.md)
