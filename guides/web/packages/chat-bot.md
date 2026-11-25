---
title: "Чат-боты"
description: "Как написать чат-бота для ИТД и научить его отвечать на сообщения."
---

# @itd-api/chat-bot

Библиотека для создания ботов в чатах ИТД.

## Установка

```bash
npm install itd-api @itd-api/chat-bot
```

Для примера ниже нужны Node.js 22 или новее и `itd-api` версии `>=0.14.1 <1.0.0`.
Если в вашей среде нет WebSocket, передайте его реализацию в `events.chats.webSocketImpl`.

## Запуск

Запишите токен аккаунта бота в `ITD_TOKEN`. После запуска отправьте ему `/start` или `/echo Привет` в чате.

```ts
import { ChatBot } from '@itd-api/chat-bot';
import { ItdClient } from 'itd-api';

const token = process.env.ITD_TOKEN;
if (!token) throw new Error('Укажите ITD_TOKEN');

const itd = new ItdClient({ auth: token });
const bot = new ChatBot(itd);

bot.command('start', (ctx) => ctx.reply('Привет!'));
bot.command('echo', (ctx) => ctx.replyTo(ctx.args || 'Напишите текст после /echo'));

await bot.start();
```

`bot.isRunning` остаётся `true` при запуске и переподключении. `bot.isReady` показывает,
открыто ли соединение для получения событий.

При завершении приложения вызовите `bot.stop()`, дождитесь обработчиков через
`await bot.drain()`, затем закройте клиент через `await itd.close()`.

## На что бот может реагировать

- `bot.command('помощь', ...)` срабатывает на `/помощь` и `/Помощь`. Текст после команды доступен в `ctx.args`, её имя в нижнем регистре — в `ctx.command`.
- `bot.hears('помощь', ...)` срабатывает, когда сообщение целиком совпадает с фразой. Можно передать регулярное выражение и прочитать совпадение в `ctx.match`.

По умолчанию команды начинаются с `/`. Чтобы принимать также `!помощь`, передайте
`commandPrefixes: ['/', '!']` в настройки бота. Если подходят несколько префиксов, используется самый длинный.

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

## Как ответить сообщением или файлом

`ctx.reply()` отправляет сообщение в тот же чат. `ctx.replyTo()` добавляет цитату исходного сообщения.
`ctx.send()` принимает [`message()`](/reference/builders#message-builder) с разметкой, файлами и карточками постов.
Если файлы уже собраны в отдельный список, передайте его в `ctx.sendWithAttachments()`.
`ctx.sendAction()` показывает собеседнику, что бот печатает.

```ts
import { message } from 'itd-api';

await ctx.send(message('Готово').attach(file));
```

## Как получить профиль автора

`ctx.itd` — клиент, который вы передали боту. Передайте `ctx.senderId` в `users.get()`,
чтобы получить профиль автора сообщения.

```ts
bot.command('profile', async (ctx) => {
  if (!ctx.senderId) return;
  const profile = await ctx.itd.users.get(ctx.senderId, { signal: ctx.signal });
  await ctx.reply(`Ваш профиль: @${profile.username}`);
});
```

Для работы с [Hydrate](./hydrate.md) передайте `new ChatBot(hydrateClient(itd))`.

## Как разделить обработчики по модулям

Соберите обработчики в отдельном `ChatComposer` и подключите его через `bot.use()`:

```ts
import { ChatComposer } from '@itd-api/chat-bot';

const help = new ChatComposer();
help.command('помощь', (ctx) => ctx.reply('Напишите, чем вам помочь.'));
bot.use(help);
```

`filter()`, `command()`, `hears()` и `on()` для событий чата возвращают ветку.
Обработчики в ней срабатывают только при совпадении. Для независимых веток вызывайте эти методы
на одном боте или модуле. Если совпали несколько условий, обработчики идут в порядке регистрации,
а `await next()` передаёт обработку дальше. Подключённые модули используют префиксы команд бота.

Для своего условия используйте `filter()`. Например, из событий о действиях собеседника
можно выбрать только запись видео.

```ts
import { ChatActionType, ChatUpdateType } from 'itd-api';

bot.on(ChatUpdateType.Typing).filter(
  (ctx) => ctx.update.action === ChatActionType.RecordVideo,
  (ctx) => console.log('Собеседник записывает видео', ctx.chatId),
);
```

Передайте один роутер нескольким модулям, чтобы каждый зарегистрировал свою ветку:

```ts
const chats = bot.router((ctx) => ctx.chatId);

function registerSupport(routes: typeof chats) {
  routes.route('support-chat-id').command('помощь', (ctx) => ctx.reply('Опишите проблему.'));
}

function registerTeam(routes: typeof chats) {
  routes.route('team-chat-id').command('статус', (ctx) => ctx.reply('Бот на связи.'));
}

registerSupport(chats);
registerTeam(chats);
```

Для чатов без маршрута можно добавить `chats.otherwise().use(handler)`. Если достаточно одного
условия, используйте `bot.branch(condition, onMatch, onMismatch)`. Последний обработчик необязателен.

Чтобы обработать ошибки одной ветки, добавьте `errorBoundary()` перед её обработчиками:

```ts
const safe = bot.errorBoundary(({ error }) => console.error('Ошибка команды', error));
safe.command('статус', (ctx) => ctx.reply('Бот на связи.'));
```

`next()` в обработчике ошибки продолжает внешнюю цепочку. При включённом `checkpoint`
событие с перехваченной ошибкой не считается обработанным.

## Как запоминать данные между сообщениями

Например, бот может считать, сколько раз вызвали `/count` в каждом чате.
Для этого подключите `session()` и храните счётчик в `ctx.session`.

```ts
import { ChatBot, ChatContext, session } from '@itd-api/chat-bot';

type State = { count: number };
class Context extends ChatContext<typeof itd> {
  session: State | undefined;
}

const bot = new ChatBot(itd, { createContext: (...args) => new Context(...args) });

bot.use(session({ initial: () => ({ count: 0 }) }));
bot.command('count', (ctx) => {
  const count = (ctx.session?.count ?? 0) + 1;
  ctx.session = { count };
  return ctx.reply(`Счётчик: ${count}`);
});
```

У каждого чата свой счётчик. По умолчанию данные хранятся в памяти и сбрасываются при перезапуске.
Чтобы сохранить их в файл, передайте `FileKeyValueStore` из `itd-api/node` в настройке `storage`.
Чтобы очистить данные текущего чата, присвойте `ctx.session = undefined`.

## Как возобновить обработку после перезапуска

Передайте `checkpoint` при создании бота, чтобы `bot.start()` продолжал с сохранённого номера события.
Для каждого аккаунта используйте свой ключ.

```ts
import { FileKeyValueStore } from 'itd-api/node';

const bot = new ChatBot(itd, {
  checkpoint: {
    storage: new FileKeyValueStore<number>('bot-state.json'),
    key: 'echo-bot:account-id',
  },
});
```

Бот сохраняет номер после успешной обработки события и всех предыдущих. После ошибки
обработчика при следующем запуске бот может снова получить часть событий.

Чтобы начать с конкретного номера, передайте его в `bot.start(eventSeq)`. Если подключались
к событиям напрямую через `itd.chats.events.connect()`, сначала вызовите
`itd.chats.events.disconnect()`.

## Как настроить обработку событий

По умолчанию бот обрабатывает события последовательно. Настройка `concurrency: 4` позволяет
обрабатывать до четырёх чатов одновременно. Внутри каждого чата порядок сохраняется.

`maxPendingUpdates` задаёт размер очереди, по умолчанию 256 событий. При переполнении бот
заканчивает принятую работу и пытается догрузить пропущенные события.

Для ошибок команд и middleware используйте `bot.catch((error, ctx) => ...)`.
По умолчанию эти ошибки выводятся в логгер клиента или в консоль.

[Все методы и типы пакета](/api/generated/chat-bot/).
[Полный пример бота](https://github.com/KiowDev/itd-api/blob/main/guides/web/packages/examples/chat-bot.mjs).
