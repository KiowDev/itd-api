---
title: "Конфигурация чат-бота"
description: "Настройки ChatBot: префиксы команд, очередь, сохранение номера события и свой контекст."
---

# Конфигурация

Настройки передаются вторым аргументом в `new ChatBot(itd, options)`.

## Префиксы команд {#command-prefixes}

`commandPrefixes` задаёт префиксы для команд бота и его модулей. По умолчанию используется `['/']`.
Передайте непустой список префиксов без пробелов. Если подходят несколько, срабатывает самый длинный.

```ts
const bot = new ChatBot(itd, { commandPrefixes: ['/', '!'] });
bot.command('помощь', (ctx) => ctx.reply('Чем помочь?'));
// Команда сработает и на /помощь, и на !помощь.
```

## Параллельность и очередь {#queue}

| Параметр | По умолчанию | За что отвечает |
| --- | --- | --- |
| `concurrency` | `1` | Сколько чатов бот может обрабатывать одновременно. Внутри каждого чата события идут по порядку. |
| `maxPendingUpdates` | `256` | Сколько обновлений могут ждать в очереди. Уже выполняющиеся обработчики сюда не входят. |

Оба параметра принимают положительные целые числа. Например, `concurrency: 4` позволяет другим
чатам получать ответы, пока в одном чате выполняется долгая команда. См. [работу с очередью](./runtime.md#queue).

## Сохранение номера события {#checkpoint}

`checkpoint` позволяет продолжить обработку с сохранённого номера события после перезапуска.
Передайте `storage` для хранения номера и отдельный `key` для каждой пары «бот и аккаунт».
По умолчанию сохранение выключено.

```ts
import { FileKeyValueStore } from 'itd-api/node';

const bot = new ChatBot(itd, {
  checkpoint: {
    storage: new FileKeyValueStore<number>('bot-state.json'),
    key: 'echo-bot:account-id',
  },
});
```

## Свой контекст {#create-context}

`createContext` задаёт, как создавать [`ctx`](./actions.md#context) для обработчиков.
По умолчанию бот создаёт `ChatContext`. Используйте свой класс, если обработчикам нужны общие свойства или методы.

```ts
import { ChatBot, ChatContext } from '@itd-api/chat-bot';

class BotContext extends ChatContext<typeof itd> {
  get chatLabel() {
    return this.chatId ? `Чат ${this.chatId}` : 'Чат неизвестен';
  }
}

const bot = new ChatBot(itd, { createContext: (...args) => new BotContext(...args) });
bot.command('чат', (ctx) => ctx.reply(ctx.chatLabel));
```
