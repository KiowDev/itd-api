# Аккаунты — `ItdAccounts`

Контейнер именованных `ItdClient`: у каждого аккаунта свой токен, cookie и `deviceId`,
а сессии всех складываются в одно хранилище (`MultiTokenStorage`). Имя аккаунта выбираете вы;
сервер о нём ничего не знает. Полное руководство — [Несколько аккаунтов](../multi-accounts/).

```ts
new ItdAccounts(options?: ItdAccountsOptions)
createAccounts(options?: ItdAccountsOptions): ItdAccounts   // фабрика
```

## Методы

```ts
addAccount(name: string, options?: AddAccountOptions): ItdClient
```
Заводит аккаунт. Возвращает обычный `ItdClient` со всеми ресурсами. Хранилище подставляется
само — срез общего по имени. `auth` не обязателен, если сессия уже в хранилище.

```ts
account(name: string): ItdClient
```
Клиент аккаунта. Бросает `ItdConfigError`, если аккаунта нет.

```ts
restore(): Promise<string[]>
```
Поднимает аккаунты, сессии которых уже лежат в хранилище (после перезапуска — без `auth` и
капчи). Возвращает имена добавленных.

```ts
removeAccount(name: string, options?: RemoveAccountOptions): Promise<boolean>
```
Убирает аккаунт: закрывает клиента и, при `forget: true`, забывает сессию. Сетевого запроса
не делает — для завершения сессии на сервере вызовите `itd.auth.logout()` до удаления.

```ts
has(name: string): boolean
names(): string[]
get size: number
get storage: MultiTokenStorage
```
Состав контейнера.

```ts
use(plugin: ClientPlugin): this
pluginNames(): string[]
hasPlugin(name: string): boolean
unuse(name: string): Promise<boolean>
```
Подключает плагин всем аккаунтам — и заведённым, и будущим; показывает общий набор или
отключает плагин сразу у всех клиентов.

```ts
on<K>(event: K, listener): Unsubscribe
```
Подписка на [события авторизации всех аккаунтов](#события-accountevents) сразу.

```ts
close(): Promise<void>
dispose(): Promise<void>
```
`close()` временно закрывает все аккаунты и останавливает общую очередь, не отключая
плагины. `dispose()` дополнительно вызывает teardown плагинов, отзывает storage-срезы и
подписки и терминально закрывает контейнер вместе с клиентами. Новые аккаунты, запросы и
плагины после него завершаются с `ItdStateError`. `await using` вызывает `dispose()`.

```ts
[Symbol.iterator](): IterableIterator<[string, ItdClient]>
```
Перебор парами «имя — клиент»: `for (const [name, itd] of accounts) { … }`.

## События (`AccountEvents`)

Те же, что у одиночного клиента, плюс имя аккаунта:

| Событие | Данные |
|---|---|
| `tokens` | `{ account, accessToken }` |
| `signIn` | `{ account, accessToken }` |
| `signOut` | `{ account }` |
| `authError` | `{ account, error }` |

## Опции

```ts
interface ItdAccountsOptions extends Omit<ItdClientOptions, 'auth' | 'storage' | 'deviceId'> {
  storage?: MultiTokenStorage;           // по умолчанию MemoryMultiTokenStorage
  plugins?: readonly ClientPlugin[];     // подключаются каждому аккаунту
  rateLimitScope?: 'account' | 'shared'; // очередь: своя у каждого / общая; по умолчанию 'shared'
}

type AddAccountOptions = Omit<ItdClientOptions, 'storage'>;

interface RemoveAccountOptions {
  forget?: boolean;                      // удалить и сохранённую сессию; по умолчанию false
}
```

Лимиты итд.com считаются по IP, поэтому по умолчанию очередь общая. Её настройки задаются
контейнеру опцией `rateLimit`; аккаунту можно передать только `rateLimit: false`, чтобы
вывести его из общей очереди. `rateLimitScope: 'account'` даёт каждому свою очередь и нужен
при разных адресах — например, при своём прокси у каждого аккаунта. Подробнее —
в [«Ограничениях частоты»](/reference/rate-limits).
