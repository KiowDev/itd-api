---
title: "Данные диалога"
description: "Как хранить состояние чат-бота между сообщениями, выбирать ключ сессии и сохранять данные в файл."
---

# Данные диалога

`session()` позволяет хранить данные в контексте чата через `ctx.session`. Следующий обработчик
в том же чате может прочитать сохранённый язык, ответы пользователя или текущий шаг диалога.

Подключите `session()` перед обработчиками, которым нужны эти данные. Функция `initial` задаёт
начальное состояние, если записи ещё нет. Чтобы удалить запись, присвойте `ctx.session = undefined`.

## Настройка хранилища

По умолчанию данные хранятся в памяти процесса. Для сохранения между запусками передайте
`storage`. В Node.js можно использовать `FileKeyValueStore` из `itd-api/node`:

```ts
import { session } from '@itd-api/chat-bot';
import { FileKeyValueStore } from 'itd-api/node';

type DialogData = { language?: string; step?: 'name' | 'city' };

const dialogSession = session({
  storage: new FileKeyValueStore<DialogData>('dialogues.json'),
  initial: (): DialogData => ({}),
});
```

Вызовите `bot.use(dialogSession)` у бота с полем `session` в контексте, как в примере ниже.
Для другого хранилища подходит любой адаптер [`KeyValueStore`](/reference/storage#общии-key-value-backend).
Если несколько ботов используют одно хранилище, задайте каждому свой `prefix`.

## Ключ сессии

По умолчанию у каждого чата своя запись. Через `getSessionKey` можно выбрать другой ключ,
например `(ctx) => ctx.senderId`, чтобы хранить одну запись на пользователя во всех чатах бота.

## Пример со счётчиком

Команда `/count` увеличивает счётчик в текущем чате.

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
