# Посты — `itd.posts`

Лента, публикация, реакции, репосты, опросы и комментарии к постам. Публикующие методы
принимают объект, [билдер](./builders.md) или функцию-настройщик.

## Лента

```ts
list(params?: FeedParams): Promise<Page<Post>>
iterate(params?: FeedParams): Paginator<Post>
```
Страница ленты / перебор ленты. Курсорная пагинация. См. [`Post`](./models.md#post),
[`FeedTab`](./enums.md#feedtab).

## Публикация

```ts
create(input: PostInput): Promise<Post>
```
Публикует пост. Файлы из поля `files` загружаются автоматически, порядок вложений сохраняется.

```ts
get(postId: string): Promise<Post>
```
Один пост вместе с топовыми комментариями (заполнено поле `comments`).

```ts
update(postId: string, input: PostUpdateInput): Promise<PostUpdateResult>
```
Редактирует текст и разметку. Поля создания (вложения, опрос, стена) отвергаются до запроса.
`content` обязателен.

```ts
remove(postId: string): Promise<void>
restore(postId: string): Promise<void>
```
Удаляет / восстанавливает пост.

## Реакции, репосты, закрепление

```ts
like(postId: string): Promise<LikeResult>
unlike(postId: string): Promise<LikeResult>
```
Ставит / убирает реакцию. См. [`LikeResult`](./models.md#likeresult).

```ts
repost(postId: string, content?: string): Promise<Post>
unrepost(postId: string): Promise<void>
```
Репост с необязательным комментарием / отмена репоста. Вложения к репосту не поддерживаются.

```ts
pin(postId: string): Promise<PinPostResult>
unpin(postId: string): Promise<PinPostResult>
```
Закрепляет / открепляет пост в профиле. См. [`PinPostResult`](./models.md#pinpostresult).

## Опросы

```ts
vote(postId: string, optionIds: string[]): Promise<Poll>
```
Голосует в опросе. Несколько вариантов допустимы только при `multipleChoice`. См.
[`Poll`](./models.md#poll).

## Счётчики

```ts
stats(ids: string[]): Promise<PostStats[]>
```
Счётчики сразу для нескольких постов. См. [`PostStats`](./models.md#poststats).

## Стена и лайки пользователя

```ts
byUser(user: UserRef, params?: UserPostsParams): Promise<Page<Post>>
iterateByUser(user: UserRef, params?: UserPostsParams): Paginator<Post>
```
Стена пользователя.

> ⚠️ Это **не только его собственные посты**: сюда попадают и записи, которые другие оставили
> на его стене (у них `author` чужой, `wallRecipient` — владелец стены). Поэтому записей обычно
> больше, чем `postsCount` в профиле. Нужны только авторские — отфильтруйте по `post.author.id`.

```ts
likedByUser(user: UserRef, params?: UserPostsParams): Promise<Page<Post>>
iterateLikedByUser(user: UserRef, params?: UserPostsParams): Paginator<Post>
```
Посты, которые пользователь отметил реакцией.

## Комментарии к посту

Комментарии **к посту** живут здесь; ответы на комментарии — в [`itd.comments`](./comments.md).

```ts
comments(postId: string, params?: CommentsParams): Promise<Page<Comment>>
iterateComments(postId: string, params?: CommentsParams): Paginator<Comment>
```
Комментарии к посту. Курсорная пагинация. См. [`Comment`](./models.md#comment),
[`CommentSort`](./enums.md#commentsort).

```ts
comment(postId: string, input: CommentInput | string): Promise<Comment>
```
Комментирует пост. Строка — это просто текст.

```ts
voiceComment(postId: string, audio: FileInput): Promise<Comment>
```
Голосовой комментарий: без текста, одно аудиовложение `audio/ogg`.

## Типы

```ts
type PostInput = CreatePostInput | PostBuilder | ((b: PostBuilder) => PostBuilder | CreatePostInput);
type PostUpdateInput = UpdatePostInput | PostBuilder | ((b: PostBuilder) => PostBuilder | UpdatePostInput);
type CommentInput = CreateCommentInput | CommentBuilder | ((b: CommentBuilder) => CommentBuilder | CreateCommentInput);

interface CreatePostInput {
  content?: string;
  spans?: Span[];                        // проверяются относительно content
  wallRecipientId?: UserId | null;       // строго UUID
  attachmentIds?: string[];              // заранее загруженные вложения
  files?: FileInput[];                   // загрузятся перед публикацией, порядок сохраняется
  poll?: PollInput;
}

interface UpdatePostInput {
  content: string;                       // обязателен
  spans?: Span[];
}

interface FeedParams {
  tab?: FeedTab;                         // по умолчанию популярное
  limit?: number;
  cursor?: string;                       // непрозрачный, из nextCursor
}

interface UserPostsParams {
  limit?: number;
  cursor?: string;
  sort?: string;
  pinnedPostId?: string;                 // поднять закреплённый пост наверх
}

interface CommentsParams {
  limit?: number;
  cursor?: string;                       // id последнего полученного комментария
  sort?: CommentSort;
}
```

См. также [Билдеры](./builders.md) (`post()`, `comment()`, `poll()`, разметка текста).
