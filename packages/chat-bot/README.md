# @itd-api/chat-bot

Библиотека для создания ботов в чатах ИТД. Бот может отвечать на сообщения, отправлять файлы и запоминать данные отдельно для каждого чата.

[Руководство](https://kiowdev.github.io/itd-api/packages/chat-bot) ·
[Сигнатуры API](https://kiowdev.github.io/itd-api/api/generated/chat-bot/)

```bash
npm install itd-api @itd-api/chat-bot
```

Для примера нужны Node.js 22 или новее и `itd-api` версии `>=0.14.1 <1.0.0`.
Запишите токен аккаунта бота в `ITD_TOKEN` и отправьте ему `/start` после запуска.

```ts
import { ChatBot } from '@itd-api/chat-bot';
import { ItdClient } from 'itd-api';

const token = process.env.ITD_TOKEN;
if (!token) throw new Error('Укажите ITD_TOKEN');

const itd = new ItdClient({ auth: token });
const bot = new ChatBot(itd);

bot.command('start', (ctx) => ctx.reply('Привет!'));

await bot.start();
```

При завершении приложения вызовите `bot.stop()`, дождитесь обработчиков через
`await bot.drain()`, затем закройте клиент через `await itd.close()`.
