---
title: "Действия в чате"
description: "Как отправлять сообщения и файлы, ставить реакции и получать сведения о собеседнике."
---

# Действия в чате

## Что доступно через `ctx` {#context}

`ctx` — контекст, который бот передаёт обработчику команды или события чата. Через него можно
прочитать данные события и ответить в том же чате.

| Что нужно | Где взять |
| --- | --- |
| Данные сообщения и идентификаторы | `ctx.message`, `ctx.text`, `ctx.senderId`, `ctx.messageId`, `ctx.chatId` |
| Данные события, например новые реакции | `ctx.update` |
| Методы клиента вне контекста | `ctx.itd` или `ctx.chats` для запросов к чатам |

У некоторых событий есть только ID сообщения. Например, при изменении реакций можно использовать
`ctx.messageId` и `ctx.update.reactions`, а полное сообщение в `ctx.message` может отсутствовать.
Через [`createContext`](./configuration.md#create-context) можно добавить свои свойства и методы.

## Ответы и вложения

Все три метода отправляют сообщение в текущий чат и принимают готовый объект, билдер
[`message()`](/reference/builders#message-builder) или функцию сборки.

| Метод | Когда использовать |
| --- | --- |
| `ctx.send(input)` | Отправить собранное сообщение. В `replyToId` можно указать сообщение, на которое нужно ответить. |
| `ctx.reply(input)` | Отправить сообщение. Для текста есть короткая форма `ctx.reply(text, fields?)`. |
| `ctx.replyTo(input)` | Ответить на `ctx.message`. ID исходного сообщения подставляется автоматически. Для текста есть короткая форма `ctx.replyTo(text, fields?)`. |

В короткой форме через `fields` можно передать файлы, ID готовых вложений или разметку.
Например, `ctx.replyTo('Готово', { files: [file] })`. Такой же ответ можно собрать билдером:

```ts
import { message } from 'itd-api';

await ctx.replyTo(message('Готово').attach(file));
```

## Отметить сообщения прочитанными

`await ctx.markRead()` отмечает сообщения текущего чата прочитанными до сообщения из
`ctx.message` включительно.

## Пересылка и реакции

`await ctx.forwardTo(targetChatId)` пересылает текущее сообщение в другой чат. Проверьте `ok` и
`failed` в результате пересылки.

`await ctx.react('👍')` добавляет реакцию к сообщению и сохраняет уже выбранные реакции бота.
Для пользовательского эмодзи передайте `{ type: ChatReactionType.Custom, fileId }`.

## Статус «печатает»

`ctx.withTyping(fn)` обновляет статус «печатает» во время выполнения задачи и возвращает её результат.
Передайте `{ startPaused: true }` вторым аргументом, если статус нужно показать после подготовки.

```ts
bot.command('сводка', async (ctx) => {
  const text = await ctx.withTyping(async ({ start }) => {
    const chat = await ctx.getChat();
    if (!chat) return 'Чат недоступен.';

    start();
    return buildSummary(chat.chatId);
  }, { startPaused: true, interval: 3_000 });

  await ctx.reply(text);
});
```

В примере `buildSummary()` — ваша функция подготовки ответа. Пока она выполняется, бот обновляет статус.
По умолчанию между обновлениями проходит 4 секунды. Пауза настраивается через `interval` в миллисекундах.
Внутри задачи `stop()` приостанавливает обновления, а `start()` возобновляет их. После завершения
задачи статус исчезает сам. Для разового обновления используйте `await ctx.sendAction()`.

## Собеседник и чат

### Получить профиль отправителя

`ctx.getSender()` загружает профиль автора сообщения.

```ts
bot.command('profile', async (ctx) => {
  const profile = await ctx.getSender();
  if (profile) await ctx.reply(`Ваш профиль: @${profile.username}`);
});
```

### Получить сведения о чате

`ctx.getChat()` загружает сводку текущего чата, включая название и число непрочитанных сообщений.

```ts
bot.command('чат', async (ctx) => {
  const chat = await ctx.getChat();
  if (chat) await ctx.reply(`${chat.title ?? 'Чат'} · непрочитанных: ${chat.unreadCount}`);
});
```

`getSender()` и `getChat()` сохраняют методы моделей [Hydrate](../hydrate.md), если передать
в бота `new ChatBot(hydrateClient(itd))`.

### Принять запрос на переписку

`ctx.acceptRequest()` принимает запрос, если в событии есть `isRequest: true`.
Если сведений в событии нет, можно проверить их через `ctx.getChat()`.

```ts
bot.command('начать', async (ctx) => {
  if (!(await ctx.acceptRequest())) {
    const chat = await ctx.getChat();
    if (chat?.isRequest) await ctx.chats.acceptRequest(chat.chatId);
  }

  await ctx.reply('Привет! Чем помочь?');
});
```
