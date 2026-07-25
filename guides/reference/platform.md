# Платформа — `itd.platform`

Журнал изменений, анонсы, баннер события и статус сервисов. Авторизация этим методам не нужна.

## Методы

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

```ts
const status = await itd.platform.status();
const auth = status.services.find((s) => s.id === 'auth');
const days = auth ? statusDays(auth) : [];
days[0]?.uptime;   // доступность за сегодня
```
