---
description: "Чаты в itd-api: личные сообщения, история, реакции, вложения и события."
---

# Чаты — `itd.chats`

Чаты доступны в `ItdClient` и `createRestClient()`. Для запросов нужен токен доступа.
Методы принимают ID чата (`chatId`), сообщения (`messageId`) или пользователя (`userId`).

## Быстрый пример

```ts
import { ItdClient } from 'itd-api';

const itd = new ItdClient({ auth: token });

try {
  const { chats } = await itd.chats.list({ limit: 10 });
  for (const chat of chats) {
    console.log(chat.title, chat.unreadCount);
  }

  const { chatId } = await itd.chats.createDirect(userId);
  const { messageId } = await itd.chats.sendMessage(chatId, { text: 'Привет!' });
  console.log(messageId);
} finally {
  await itd.close();
}
```

## Список и история

```ts
list(params?: ChatListParams): Promise<ChatListPage>
iterate(params?: ChatListParams): Paginator<ChatSummary>
get(chatId: string): Promise<ChatSummary>
unread(): Promise<ChatUnreadState>
```

`list()` возвращает чаты, число непрочитанных в каждом и курсор `nextBefore`.
Для следующей страницы передайте его как `before`. `iterate()` подставляет курсор сам.
`get()` загружает один чат, а `unread()` возвращает общее число непрочитанных и число чатов с непрочитанным.

```ts
messages(chatId: string, params?: ChatListParams): Promise<ChatHistoryPage>
iterateMessages(chatId: string, params?: ChatListParams): Paginator<ChatMessage>
messagesAround(chatId: string, messageId: string, limit?: number): Promise<ChatHistoryPage>
```

История идёт от новых сообщений к старым. При ручной пагинации передайте ID
последнего сообщения страницы как `before`. `messagesAround()` загружает часть
истории с обеих сторон указанного сообщения.

```ts
for await (const message of itd.chats.iterateMessages(chatId, { limit: 20 })) {
  console.log(message.senderId, message.text);
}
```

## Отправка, правка и удаление

```ts
createDirect(userId: string): Promise<ChatDirectResult>
sendMessageToUser(userId: string, input: Omit<SendChatMessageInput, 'replyToId'>): Promise<ChatFirstMessage>
sendMessage(chatId: string, input: SendChatMessageInput): Promise<ChatSentMessage>
editMessage(chatId: string, messageId: string, input: ChatMessageContent): Promise<ChatEditedMessage>
```

`createDirect()` возвращает ID существующего личного диалога или создаёт его.
`sendMessageToUser()` сразу отправляет сообщение по ID собеседника и возвращает ID чата и сообщения.
Для ответа на конкретное сообщение укажите `replyToId` при вызове `sendMessage()`.
Если передаёте собственный `clientMessageId`, используйте UUIDv7.
Для форматирования текста используйте [`messageMarkup()`](./builders.md#message-markup).

```ts
await itd.chats.editMessage(chatId, messageId, { text: 'Привет! Как дела?' });
```

`forwardMessages()` принимает целевой чат, `sourceChatId` и `messageIds`.
`deleteMessagesForMe()` удаляет сообщения у вас, `deleteMessagesForAll()` — у всех.
При пересылке и пакетном удалении проверяйте списки `ok` и `failed`.

## Прочтение и настройки чата

| Метод | Действие |
| --- | --- |
| `markRead(chatId, messageId)` | Отмечает историю прочитанной до этого сообщения включительно. |
| `setUnread(chatId, unread)` | Ставит или снимает ручную отметку непрочитанного. |
| `setPinned(chatId, pinned)` | Закрепляет или открепляет чат. |
| `setMuted(chatId, muted)` | Отключает или включает уведомления чата. |
| `acceptRequest(chatId)` | Принимает запрос на переписку. |
| `markHeard(chatId, messageId)` | Отмечает голосовое сообщение прослушанным. |
| `heardMessages(chatId, messageIds)` | Возвращает ID прослушанных сообщений из переданного списка. |
| `clearHistory(chatId, forEveryone?)` | Очищает историю. Передайте `true`, чтобы очистить её у всех. |
| `delete(chatId, forEveryone?)` | Удаляет чат у вас или у всех, если передать `true`. |

`presence(userId)` проверяет, в сети ли собеседник. `presenceMany(userIds)` делает это
одним запросом и возвращает объект `{ [userId]: boolean }`.
`sendAction(chatId, type, progress?)` сообщает собеседнику, что вы печатаете, записываете
или загружаете файл. Тип действия задаётся через `ChatActionType`. Для загрузки
`progress` — доля от 0 до 1.

## Реакции

`reactionCatalog()` возвращает доступные реакции, а `reactions()` — реакции
на сообщение и их текущую версию. `setReactions()` заменяет ваш набор целиком.
Пустой массив снимает ваши реакции. Если версия устарела, сначала перечитайте состояние.

```ts
import { ChatReactionType } from 'itd-api';

const { reactionVersion } = await itd.chats.reactions(chatId, messageId);
await itd.chats.setReactions(chatId, messageId, {
  reactions: [{ type: ChatReactionType.Emoji, emoji: '👍' }],
  expectedVersion: reactionVersion,
  operationId: crypto.randomUUID(),
});
```

## Вложения

`uploadFile()` принимает те же источники, что и [`itd.files.upload()`](./files.md).
Если передаёте файл потоком, укажите его размер заранее. Колбэк `onProgress` получает
число отправленных байтов и общий размер файла.

```ts
const { fileId } = await itd.chats.uploadFile(file);
await itd.chats.sendMessage(chatId, { text: '', attachmentIds: [fileId] });
const [link] = await itd.chats.fileLinks(chatId, [fileId]);
const downloadUrl = link ? new URL(link.url, itd.baseUrl) : undefined;
```

`media(chatId, category, params?)` возвращает вложения из истории.
Категорию задайте через `ChatMediaCategory`. Для следующей страницы передайте `nextBefore`
как `before`. `fileLinks()` получает свежие ссылки на уже отправленные вложения.

## События

В [руководстве по чат-ботам](/packages/chat-bot) есть пример бота, который отвечает на сообщения.

В полном клиенте `itd.chats.events` получает события по WebSocket. Передайте
`eventSeq` из списка чатов в `connect()`, чтобы получить изменения, которые произошли
после загрузки списка. После обрыва связи клиент догружает пропущенное автоматически.

```ts
const { eventSeq } = await itd.chats.list();
const events = itd.chats.events;
events.on('update', (event) => console.log(event.type, event.chatId));
await events.connect(eventSeq ?? undefined);
```

Если сервер при догрузке вернёт обновлённые сводки чатов, клиент передаст их через
`chatSummaries`. При событии `resetRequired` загрузите список и нужную историю заново,
затем вызовите `connect()` со свежим `eventSeq`.

Для работы без WebSocket вызывайте `updates(since)`. Передавайте `nextEventSeq` из ответа
в следующий вызов. Если сервер вернул `resetRequired: true`, начните с нового списка чатов.

Все HTTP-пути и параметры перечислены в [справочнике API](./endpoints.md#чаты).
