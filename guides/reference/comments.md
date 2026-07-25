# Комментарии — `itd.comments`

Ответы на комментарии и действия над ними. Комментарии **к посту** живут в
[`itd.posts`](./posts.md#комментарии-к-посту): `itd.posts.comments()` и `itd.posts.comment()`.

## Ответы

```ts
replies(commentId: string, params?: RepliesParams): Promise<Page<Comment>>
iterateReplies(commentId: string, params?: RepliesParams): Paginator<Comment>
```
Ответы на комментарий. Здесь пагинация **постраничная** (у комментариев к посту — курсорная).
См. [`Comment`](./models.md#comment).

```ts
reply(commentId: string, input: CommentInput | string): Promise<Comment>
```
Отвечает на комментарий. Поддерживает `replyTo(userId)` в билдере — адресат ответа.

## Действия

```ts
update(commentId: string, content: string): Promise<Comment>
```
Редактирует текст комментария.

```ts
remove(commentId: string): Promise<void>
restore(commentId: string): Promise<Comment>
```
Удаляет / восстанавливает комментарий.

```ts
like(commentId: string): Promise<LikeResult>
unlike(commentId: string): Promise<LikeResult>
```
Ставит / убирает реакцию. См. [`LikeResult`](./models.md#likeresult).

## Типы

```ts
type CommentInput = CreateCommentInput | CommentBuilder | ((b: CommentBuilder) => CommentBuilder | CreateCommentInput);

interface CreateCommentInput {
  content?: string;                      // у голосового пустой
  attachmentIds?: string[];
  files?: FileInput[];
  replyToUserId?: UserId;                // только в reply(), не в комментарии к посту
}

interface RepliesParams extends RequestOptions {
  limit?: number;
  page?: number;
  maxPages?: number;
}
```

См. также [Билдеры](./builders.md) (`comment()`).
