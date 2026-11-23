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

Вызовите `bot.stop()`, чтобы остановить бота. Из кода завершения приложения дождитесь
завершения работы через `await bot.drain()`, затем вызовите `await itd.close()`.

`bot.start(eventSeq)` загружает события, которые произошли после указанного номера. Если номер устарел, бот берёт актуальный из списка чатов.
События, которые бот уже принял, продолжают обрабатываться во время восстановления.

Чтобы бот запоминал последнее обработанное событие между запусками, передайте `checkpoint`:

```ts
import { FileKeyValueStore } from 'itd-api/node';

const bot = new ChatBot(itd, {
  checkpoint: {
    storage: new FileKeyValueStore<number>('bot-state.json'),
    key: 'echo-bot:account-id',
  },
});

await bot.start();
```

Подключайте канал через `bot.start()`, чтобы продолжить с сохранённого номера события.
Чтобы указать другой номер при подключении, вызовите `bot.start(eventSeq)`.
Бот сохраняет номер, когда это событие и все предыдущие обработаны успешно.
После ошибки обработчика при следующем запуске бот может получить те же события снова.

По умолчанию бот обрабатывает обновления последовательно. Чтобы обрабатывать до четырёх чатов
одновременно, используйте `new ChatBot(itd, { concurrency: 4 })`. Порядок обновлений внутри каждого
чата сохраняется.

По умолчанию в очереди могут ждать до 256 обновлений. Если боту нужно принимать больше обновлений
во время коротких всплесков, задайте лимит, например `new ChatBot(itd, { maxPendingUpdates: 1024 })`.
Когда очередь заполняется, бот временно перестаёт принимать новые события. Как только он обработает
всё, что уже принял, он подключается заново и получает пропущенные события. Если бот не может
определить, с какого события продолжить, он завершает принятые задачи и останавливается с ошибкой.
Во время запуска ошибку возвращает `start()`, после запуска она попадает в лог.

Бот использует `logger` из настроек `ItdClient`. Без настроенного логгера ошибки выводятся в
консоль. Чтобы обработать ошибку команды или middleware самостоятельно, зарегистрируйте обработчик
через `bot.catch()`.

## На что бот может реагировать

- `bot.command('echo', ...)` срабатывает на `/echo`. Текст после команды доступен в `ctx.args`.
- `bot.hears('помощь', ...)` срабатывает, когда сообщение целиком совпадает с фразой. Можно передать регулярное выражение и прочитать совпадение в `ctx.match`.
- `bot.on(ChatBotFilter.MessageAttachment, ...)` срабатывает, когда собеседник присылает вложение.

Используйте `ChatBotFilter` для отбора сообщений по их содержимому. Например, `MessageText`
выбирает сообщения с текстом, а `MessageAttachment` — с вложениями. Используйте `ChatUpdateType`
для событий чата, например прочтения сообщения или изменения реакций.

```ts
bot.on(ChatUpdateType.MessageReactions, (ctx) => {
  console.log(ctx.update.messageId, ctx.update.reactions);
});
```

Текущее сообщение доступно в `ctx.message`. Добавляйте общие действия через `bot.use()` и вызывайте `await next()`, чтобы продолжить обработку. `bot.filter()` запускает обработчик по вашему условию.

## Как ответить сообщением или файлом

`ctx.reply()` отправляет сообщение в тот же чат. `ctx.replyTo()` добавляет цитату исходного сообщения.
`ctx.sendWithAttachments()` загружает файлы и отправляет их вместе с текстом.

```ts
await ctx.sendWithAttachments({ text: 'Готово' }, [file]);
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

## Как запоминать данные между сообщениями

Например, бот может считать, сколько раз пользователь вызвал `/count` в этом чате.
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

[Все методы и типы пакета](/api/generated/chat-bot/).
