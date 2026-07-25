# Пользователи — `itd.users`

Профили, подписки, блокировки, приватность и значки. Методы принимают
[`UserRef`](./README.md#общие-соглашения) — UUID **или** имя пользователя, если не
указано иное.

## Свой профиль

```ts
me(): Promise<MyProfile>
```
Свой профиль — с подпиской и признаком подтверждённого телефона. См. [`MyProfile`](./models.md#myprofile).

```ts
updateMe(input: UpdateProfileInput): Promise<MyProfile>
```
Обновляет свой профиль. Передавайте только изменяемые поля.

```ts
createProfile(input: { username: string; displayName: string; avatar?: string }): Promise<MyProfile>
```
Создаёт профиль после регистрации.

```ts
deactivate(): Promise<void>
restore(): Promise<void>
```
Деактивирует / восстанавливает аккаунт.

## Чужие профили

```ts
get(user: UserRef): Promise<PublicProfile>
```
Профиль пользователя по UUID или имени. См. [`PublicProfile`](./models.md#publicprofile).

```ts
checkUsername(username: string): Promise<boolean>
```
Свободно ли имя пользователя.

## Подписки

```ts
follow(user: UserRef): Promise<FollowResult>
```
Подписывается. У закрытого профиля отправляется заявка — видно по полю `status`. См.
[`FollowResult`](./models.md#followresult).

```ts
unfollow(user: UserRef): Promise<void>
```
Отписывается.

```ts
followStatus(userIds: UserId[]): Promise<Record<string, boolean>>
```
Проверяет подписку сразу для нескольких пользователей. Возвращает «идентификатор → подписаны ли вы».

```ts
followers(user: UserRef, params?: UserListParams): Promise<Page<UserSummary>>
iterateFollowers(user: UserRef, params?: UserListParams): Paginator<UserSummary>
following(user: UserRef, params?: UserListParams): Promise<Page<UserSummary>>
iterateFollowing(user: UserRef, params?: UserListParams): Paginator<UserSummary>
```
Подписчики и подписки. См. [`UserSummary`](./models.md#usersummary).

> ⚠️ **Сервер эти списки не листает.** Возвращаются первые 20 записей: `page` игнорируется,
> `limit` больше 20 молча уменьшается, `hasMore` всегда `false`. Полю `total` доверять тоже
> нельзя — оно расходится с `followersCount` из профиля. Методы-итераторы закончатся после
> первых 20 записей и оставлены на случай, если пагинацию починят.

## Блокировки

```ts
block(user: UserRef): Promise<void>
unblock(user: UserRef): Promise<void>
```
Блокирует / снимает блокировку.

```ts
blocked(params?: UserListParams): Promise<Page<UserSummary>>
iterateBlocked(params?: UserListParams): Paginator<UserSummary>
```
Заблокированные пользователи. Ограничения листания те же, что у `followers`.

## Приватность

```ts
getPrivacy(): Promise<PrivacySettings>
updatePrivacy(input: UpdatePrivacyInput): Promise<PrivacySettings>
```
Читает / обновляет настройки приватности. См. [`PrivacySettings`](./models.md#privacysettings).

## Значки профиля («пины»)

```ts
pins(): Promise<PinsResult>
```
Значки профиля и выбранный из них. `activePin` — строка-идентификатор, а не объект. См.
[`PinsResult`](./models.md#pinsresult).

```ts
setPin(slug: string): Promise<void>
removePin(): Promise<void>
```
Выбирает / снимает активный значок.

## Поиск и рекомендации

Также описаны в разделе [Поиск и обнаружение](./discovery.md).

```ts
search(query: string, params?: { limit?: number }): Promise<UserSummary[]>
```
Ищет пользователей по строке запроса.

```ts
whoToFollow(): Promise<UserSummary[]>
```
Рекомендации, на кого подписаться.

```ts
topClans(): Promise<Clan[]>
```
Рейтинг кланов. См. [`Clan`](./models.md#clan).

## Типы

```ts
interface UpdateProfileInput {
  displayName?: string;
  username?: string;
  avatar?: string;                       // эмодзи-символ клана, а не URL картинки
  bio?: string;
  banner?: string;                       // URL изображения-шапки
}

type UpdatePrivacyInput = Partial<PrivacySettings>;

interface UserListParams extends RequestOptions {
  limit?: number;                        // > 20 сервер зажимает до 20
  page?: number;                         // сервер игнорирует
  maxPages?: number;
}
```
