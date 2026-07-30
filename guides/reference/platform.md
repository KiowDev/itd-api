# Платформа — `itd.platform`

Версии приложений, журнал изменений, анонсы, баннер события и статус сервисов.
`version()` и `status()` всегда выполняются без автоматической авторизации. Остальные
методы используют обычную политику клиента и при наличии сессии отправляют Bearer-токен.

## Методы

```ts
version(): Promise<PlatformVersions>
```
Минимальные и актуальные версии приложений Android и iOS. Endpoint публичный, поэтому
автоматическая авторизация не отправляется. `updateUrl` возвращается без преобразования.

```ts
const versions = await itd.platform.version();

console.log(versions.android.minVersion);
console.log(versions.android.latestVersion);
console.log(versions.android.updateUrl);
```

```ts
changelog(): Promise<ChangelogEntry[]>
```
Журнал изменений платформы. См. [`ChangelogEntry`](./models.md#changelogentry).

```ts
announcements(): Promise<Announcement[]>
```
Анонсы на главной странице. См. [`Announcement`](./models.md#announcement).

```ts
portal(): Promise<Portal>
```
Баннер текущего события — виджет «портал». См. [`Portal`](./models.md#portal). Также в
[Поиск и обнаружение](./discovery.md).

```ts
status(): Promise<PlatformStatus>
```
Состояние сервисов за последние 90 суток. Идёт на отдельный хост `статус.итд.com` без
авторизации, ответ кэшируется сервером на минуту. Работает из браузера напрямую (в отличие
от остального API). См. [`PlatformStatus`](./models.md#platformstatus).

## Статус: разбор истории

История по суткам приходит разреженным объектом (`days: Record<string, StatusDay>`); сутки
без данных сервер пропускает. Ровный массив на 90 элементов даёт функция из корня пакета:

```ts
statusDays(service: ServiceStatus): (StatusDay | null)[]
```
Индекс — сколько суток назад: `[0]` — сегодня, пропуски равны `null`. См.
[`ServiceStatus`](./models.md#servicestatus), [`StatusDay`](./models.md#statusday),
[`ServiceState`](./enums.md#servicestate).

`date_key` задаёт сутки по UTC. Время внутри готовых строк `lines[].text` указано по
Москве; отдельные структурированные поля начала и длительности инцидента сервер не
возвращает.

```ts
const status = await itd.platform.status();
const auth = status.services.find((s) => s.id === 'auth');
const days = auth ? statusDays(auth) : [];
days[0]?.uptime;   // доступность за сегодня
```

## Типы версий

```ts
interface PlatformClientVersion {
  minVersion: string;
  latestVersion: string;
  updateUrl: string;
}

interface PlatformVersions {
  android: PlatformClientVersion;
  ios: PlatformClientVersion;
  [client: string]: PlatformClientVersion;
}
```
