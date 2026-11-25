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

## Руководство

<nav class="chat-bot-topics" aria-label="Разделы руководства по чат-ботам">

- [**Конфигурация** <span>Префиксы, очередь, хранилище и свой контекст</span>](./chat-bot/configuration.md)
- [**Команды и события** <span>Команды, фразы и фильтры сообщений</span>](./chat-bot/handlers.md)
- [**Действия в чате** <span>Ответы, вложения, пересылка и реакции</span>](./chat-bot/actions.md)
- [**Модули и маршруты** <span>Ветки обработчиков для разных чатов и задач</span>](./chat-bot/routing.md)
- [**Данные диалога** <span>Состояние между сообщениями и запусками</span>](./chat-bot/state.md)
- [**Работа бота** <span>Возобновление, очередь и ошибки</span>](./chat-bot/runtime.md)
- [**Дополнения** <span>Ограничение частоты команд и событий</span>](./chat-bot/extras.md)

</nav>

[Справочник методов и типов](/api/generated/chat-bot/) ·
[Полный пример бота](https://github.com/KiowDev/itd-api/blob/main/guides/web/packages/examples/chat-bot.mjs)

<style scoped>
.chat-bot-topics ul {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 15rem), 1fr));
  gap: 12px;
  padding: 0;
  list-style: none;
}

.chat-bot-topics li {
  margin: 0;
}

.chat-bot-topics li:last-child:nth-child(odd) {
  grid-column: 1 / -1;
}

.chat-bot-topics a {
  display: grid;
  align-content: start;
  gap: 4px;
  height: 100%;
  padding: 14px 16px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-1);
  text-decoration: none;
}

.chat-bot-topics a:hover,
.chat-bot-topics a:focus-visible {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
}

.chat-bot-topics span {
  color: var(--vp-c-text-2);
  font-size: 14px;
  line-height: 1.5;
}
</style>
