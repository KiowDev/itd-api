# Уведомления — `itd.notifications`

Список, счётчик, отметки о прочтении и настройки. Все уведомления приведены к единой форме,
поэтому объекты отсюда и из [потока](./realtime.md) можно складывать в один список. См.
[`Notification`](./models.md#notification), [`NotificationType`](./enums.md#notificationtype).

## Список

```ts
list(params?: NotificationListParams): Promise<Page<Notification>>
iterate(params?: NotificationListParams): Paginator<Notification>
```
Страница уведомлений / перебор. Пагинация по смещению (`offset` / `nextOffset`).

```ts
count(): Promise<number>
```
Число непрочитанных уведомлений.

## Отметки о прочтении

```ts
markRead(notificationId: string): Promise<number>
```
Отмечает одно уведомление прочитанным. Возвращает, сколько записей отметил сервер.

```ts
markReadBatch(ids: string[]): Promise<number>
```
Отмечает несколько. Список автоматически режется на части по 20 идентификаторов, части уходят
последовательно, результат суммируется.

```ts
markAllRead(): Promise<number>
```
Отмечает прочитанными все уведомления.

## Настройки

```ts
getSettings(): Promise<NotificationSettings>
updateSettings(input: UpdateNotificationSettingsInput): Promise<NotificationSettings>
```
Читает / обновляет настройки. Отправляются только изменяемые поля. Отсутствующая настройка
считается включённой. См. [`NotificationSettings`](./models.md#notificationsettings).

## Типы

```ts
interface NotificationListParams extends RequestOptions {
  limit?: number;
  offset?: number;                       // смещение от начала списка
  maxPages?: number;
}

type UpdateNotificationSettingsInput = Partial<NotificationSettings>;
```

## Вспомогательные функции

Экспортируются из корня пакета, работают с любым `Notification`:

```ts
formatNotificationText(notification: Notification): string
```
Готовый текст: «Аня и ещё 2 оценили ваш пост».

```ts
resolveNotificationUrl(notification: Notification): string | null
```
Ссылка перехода: `/@anya/post/9f1c…`. Обычно точнее серверного `clickUrl`.

```ts
canonicalNotificationType(rawType: string): NotificationType
isKnownNotificationType(type: string): boolean
```
Приведение серверного имени типа к каноническому и проверка известности.
