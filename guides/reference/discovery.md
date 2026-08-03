# Поиск и обнаружение — `itd.search`, `itd.hashtags`

Глобальный поиск, хэштеги и тренды, а также рекомендации, кланы и баннер события. Часть
методов физически принадлежит другим ресурсам (`itd.users`, `itd.platform`) — здесь они
собраны по смыслу.

## Глобальный поиск — `itd.search`

```ts
all(query: string): Promise<SearchResult>
```
Ищет пользователей и хэштеги одним запросом.

```ts
interface SearchResult {
  users: UserSummary[];                  // см. models.md#usersummary
  hashtags: Hashtag[];                   // см. models.md#hashtag
}
```

## Хэштеги — `itd.hashtags`

```ts
search(query?: string, params?: { limit?: number }): Promise<Hashtag[]>
```
Ищет хэштеги. Без строки запроса возвращает общий список.

```ts
trending(params?: { limit?: number }): Promise<Hashtag[]>
```
Трендовые хэштеги.

```ts
posts(tag: string, params?: HashtagPostsParams): Promise<Page<Post>>
iteratePosts(tag: string, params?: HashtagPostsParams): Paginator<Post>
```
Посты по хэштегу. Курсорная пагинация. `tag` — без решётки; кодируется автоматически,
кириллица и пробелы допустимы. См. [`Post`](./models.md#post).

```ts
interface HashtagPostsParams {
  limit?: number;
  cursor?: string;
}
```

## Пользователи — `itd.users`

Полное описание — в [Пользователи](./users.md#поиск-и-рекомендации).

```ts
itd.users.search(query: string, params?: { limit?: number }): Promise<UserSummary[]>
```
Поиск пользователей по строке.

```ts
itd.users.whoToFollow(): Promise<UserSummary[]>
```
Рекомендации, на кого подписаться.

```ts
itd.users.topClans(): Promise<Clan[]>
```
Рейтинг кланов. См. [`Clan`](./models.md#clan).

## Портал — `itd.platform`

```ts
itd.platform.portal(): Promise<Portal>
```
Баннер текущего события — виджет «портал». См. [`Portal`](./models.md#portal) и
[Платформа](./platform.md).

```ts
interface Portal {
  active: boolean;
  title: string;
  url: string;
}
```
