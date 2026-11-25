---
title: "Команды и события"
description: "Как принимать команды, искать фразы в сообщениях и подписываться на события чата и бота."
---

# Команды и события

## Команды и фразы

- `bot.command('помощь', ...)` срабатывает на `/помощь` и `/Помощь`. Текст после команды доступен в `ctx.args`, её имя в нижнем регистре — в `ctx.command`.
- `bot.hears('помощь', ...)` срабатывает, когда сообщение целиком совпадает с фразой. Можно передать регулярное выражение и прочитать совпадение в `ctx.match`.

По умолчанию команды начинаются с `/`. Чтобы принимать также `!помощь`, передайте
`commandPrefixes: ['/', '!']` в [настройки бота](./configuration.md#command-prefixes).

```ts
bot.hears(/^кто такой @?(\S+)\?$/iu, async (ctx) => {
  const username = ctx.match[1];
  if (!username) return;
  const profile = await ctx.itd.users.get(username);
  await ctx.reply(`Профиль: @${profile.username}`);
});
```

## События и фильтры

| Что нужно обработать | Что передать в `bot.on()` |
| --- | --- |
| Состояние самого бота | `ChatBotLifecycleEvent` для подключения, переподключения, остановки или окончательной ошибки получения событий. |
| Событие в чате | `ChatUpdateType`, например `MessageReactions` или `MessageDeleted`. |
| Входящее сообщение по содержимому или признаку пересылки | `ChatBotFilter`, например `MessageImage`, `MessageVoice` или `MessageForward`. |

Зарегистрируйте обработчики перед `bot.start()`. Вложенные фильтры позволяют сочетать условия.

```ts
import { ChatBotFilter, ChatBotLifecycleEvent } from '@itd-api/chat-bot';
import { ChatUpdateType } from 'itd-api';

bot.on(ChatBotLifecycleEvent.Connect, () => console.log('Бот подключён'));

bot.on(ChatUpdateType.MessageReactions, (ctx) => {
  console.log(ctx.messageId, ctx.update.reactions);
});

bot.on(ChatBotFilter.MessageForward).on(ChatBotFilter.MessageVoice, (ctx) => {
  console.log('Переслано голосовое:', ctx.messageId);
});
```

Текст и вложения доступны в `ctx.message`. В событии реакции `ctx.messageId` указывает на сообщение,
к которому она относится.

<details>
<summary>Все события и фильтры bot.on()</summary>

| Набор | Значение | Когда срабатывает |
| --- | --- | --- |
| `ChatBotLifecycleEvent` | `Connect` | Открыто соединение для получения событий. |
| `ChatBotLifecycleEvent` | `Reconnect` | Запланировано переподключение. Обработчик получает номер попытки `attempt` и задержку `delay` в миллисекундах. |
| `ChatBotLifecycleEvent` | `Stop` | Бот остановился. |
| `ChatBotLifecycleEvent` | `Error` | Бот больше не может получать или восстанавливать события. Обработчик получает ошибку. |
| `ChatUpdateType` | `NewMessage` | Пришло одно новое сообщение. |
| `ChatUpdateType` | `NewMessages` | Пришёл пакет новых сообщений. |
| `ChatUpdateType` | `OwnMessages` | Получен пакет сообщений, отправленных текущим аккаунтом. |
| `ChatUpdateType` | `MessageEdited` | Сообщение отредактировано. |
| `ChatUpdateType` | `MessageDeleted` | Удалено одно сообщение. |
| `ChatUpdateType` | `MessagesDeleted` | Удалён пакет сообщений. ID доступны в `ctx.update.messageIds`. |
| `ChatUpdateType` | `MessagesRead` | Участник прочитал сообщения до `ctx.update.lastReadMessage` включительно. |
| `ChatUpdateType` | `Presence` | Пользователь появился в сети или вышел из неё. |
| `ChatUpdateType` | `Typing` | Собеседник печатает, записывает голосовое или видео либо загружает файл. Действие доступно в `ctx.update.action`. |
| `ChatUpdateType` | `ChatCreated` | Создан чат. В событии могут быть его первые сообщения. |
| `ChatUpdateType` | `ChatDeleted` | Чат удалён. |
| `ChatUpdateType` | `ChatSettings` | Изменились настройки чата, например закрепление или отметка «непрочитано». |
| `ChatUpdateType` | `HistoryCleared` | История чата очищена. |
| `ChatUpdateType` | `MessageReactions` | Изменились реакции на сообщение. |
| `ChatBotFilter` | `Message` | Любое входящее сообщение. |
| `ChatBotFilter` | `MessageText` | Входящее сообщение с текстом. |
| `ChatBotFilter` | `MessageAttachment` | Входящее сообщение с вложением. |
| `ChatBotFilter` | `MessageImage` | Входящее сообщение с изображением. |
| `ChatBotFilter` | `MessageVideo` | Входящее сообщение с видео. |
| `ChatBotFilter` | `MessageAudio` | Входящее сообщение с аудиовложением. |
| `ChatBotFilter` | `MessageVoice` | Входящее голосовое сообщение. |
| `ChatBotFilter` | `MessagePost` | Входящее сообщение с карточкой поста. |
| `ChatBotFilter` | `MessageReply` | Входящий ответ на сообщение. |
| `ChatBotFilter` | `MessageForward` | Входящее пересланное сообщение. |
| `ChatBotFilter` | `Edit` | Редактирование сообщения, как `ChatUpdateType.MessageEdited`. |
| `ChatBotFilter` | `Read` | Прочтение сообщений, как `ChatUpdateType.MessagesRead`. |

</details>
