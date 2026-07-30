# Сессии и хранилища

Хранилище позволяет пережить перезапуск приложения без нового входа. Клиент читает и
записывает сессию через `TokenStorage`; `ItdAccounts` использует `MultiTokenStorage`.
Практический сценарий разобран в [руководстве по авторизации](../authentication/).

> [!WARNING]
> Сессия содержит токены и cookie. Не коммитьте файлы сессий, не печатайте их в логах и
> выбирайте хранилище с подходящей вашему приложению моделью доступа.

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
| `LocalStorageTokenStorage` | `itd-api` | браузерный `localStorage`; при недоступности переключается на память |
| `FileTokenStorage` | `itd-api/node` | JSON-файл для Node.js, Bun и Deno |

```ts
import { LocalStorageTokenStorage } from 'itd-api';

const storage = new LocalStorageTokenStorage('my-app:itd-session');
const itd = new ItdClient({ storage });
```

`localStorage` доступен любому скрипту на странице. Не используйте его, если риск XSS
или совместный доступ к origin делает такое хранение неприемлемым.

Собственный адаптер можно передать напрямую или собрать фабрикой:

```ts
const storage = createTokenStorage({
  get: () => database.readSession(),
  set: (session) => database.writeSession(session),
  clear: () => database.deleteSession(),
});
```

Методы могут быть синхронными или асинхронными. `get()` должен вернуть `null`, если
сессии нет.

## Файловое хранилище

```ts
import { FileTokenStorage, ItdClient } from 'itd-api/node';

const itd = new ItdClient({
  storage: new FileTokenStorage('./.itd-session.json'),
});
```

`FileTokenStorage` записывает через временный файл и атомарное переименование. Файл
создаётся с правами `0600`, где это поддерживается. Операции записи и удаления
выполняются последовательно.

Добавьте путь в `.gitignore`. Отсутствующий или повреждённый файл одиночной сессии
считается пустым; остальные ошибки файловой системы не скрываются.

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
import { FileMultiTokenStorage, ItdAccounts } from 'itd-api/node';

const accounts = new ItdAccounts({
  storage: new FileMultiTokenStorage('./.itd-sessions.json'),
});

await accounts.restore();
```

Для Redis, БД или другого key-value-хранилища:

```ts
const storage = createMultiTokenStorage({
  get: (account) => redis.read(`itd:${account}`),
  set: (account, session) => redis.write(`itd:${account}`, session),
  clear: (account) => redis.remove(`itd:${account}`),
  accounts: () => redis.members('itd:accounts'),
});
```

`accounts()` должен возвращать имена сохранённых записей: по ним `restore()` находит
аккаунты после перезапуска.

## Хранилище одной общей записью

`createRecordMultiStorage()` подходит, когда источник читает и пишет всю карту сессий:

```ts
interface RecordStorageSource {
  read(): Promise<Record<string, ItdSession> | null>;
  write(record: Record<string, ItdSession>): Promise<void>;
  remove?(): Promise<void>;
}
```

Адаптер один раз загружает слепок и выстраивает изменения в последовательную очередь,
предотвращая гонку «прочитать — изменить — записать» внутри экземпляра. Несколько
процессов или несколько адаптеров для одного источника требуют внешней синхронизации.

`scopedTokenStorage(storage, account)` создаёт из `MultiTokenStorage` обычный
`TokenStorage`, привязанный к одному имени.

## Точка входа `itd-api/node`

`itd-api/node` повторно экспортирует весь основной API и заменяет `ItdClient` и
`ItdAccounts` версиями с доступом к файловой системе:

```ts
import {
  FileMultiTokenStorage,
  FileTokenStorage,
  ItdAccounts,
  ItdClient,
  createAccounts,
  createClient,
} from 'itd-api/node';
```

## Связанные разделы

- [Авторизация и сессии](../authentication/)
- [Несколько аккаунтов](../multi-accounts/)
- [Файлы](./files.md)
- [Клиент](./client.md)
