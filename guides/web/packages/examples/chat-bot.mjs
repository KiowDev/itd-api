import { ChatBot, ChatBotFilter, ChatBotLifecycleEvent } from '@itd-api/chat-bot';
import { fromUrl, isItdNotFoundError, ItdClient, message } from 'itd-api';

const token = process.env.ITD_TOKEN;
if (!token) throw new Error('Укажите токен бота в ITD_TOKEN');

const itd = new ItdClient({ auth: token });
const bot = new ChatBot(itd);
const counts = new Map();

bot.on(ChatBotFilter.Message, (ctx, next) => {
  const { senderId } = ctx;
  if (senderId) counts.set(senderId, (counts.get(senderId) ?? 0) + 1);
  return next();
});

bot.hears(/^Сколько подписчиков у @?([a-z0-9_]+)[?!.]?$/iu, async (ctx) => {
  const [, username] = ctx.match;
  try {
    const profile = await ctx.itd.users.get(username.toLowerCase(), { signal: ctx.signal });
    return ctx.reply(`Подписчиков у @${profile.username}: ${profile.followersCount}`);
  } catch (error) {
    if (isItdNotFoundError(error)) return ctx.reply(`Пользователь @${username} не найден.`);
    throw error;
  }
});

bot.command('помощь', (ctx) =>
  ctx.reply('/информация — ваш профиль и счётчик сообщений.\nСколько подписчиков у nowkie'),
);

bot.command(['информация', 'инфорация'], async (ctx) => {
  const { senderId } = ctx;
  if (!senderId) return;

  const profile = await ctx.itd.users.get(senderId, { signal: ctx.signal });
  const reply = message(
    `${profile.displayName} (@${profile.username})\n` +
      `Подписчики: ${profile.followersCount}\n` +
      `Сообщений боту: ${counts.get(senderId) ?? 0}`,
  );

  // Аватар может быть эмодзи. Прикладываем только изображения с CDN ИТД.
  const avatar = URL.canParse(profile.avatar) ? new URL(profile.avatar) : null;
  if (avatar?.origin === 'https://cdn.xn--d1ah4a.com' && avatar.pathname.startsWith('/images/')) {
    return ctx.send(reply.attach(fromUrl(avatar.href)));
  }
  return ctx.send(reply);
});

async function stop() {
  bot.stop();
  await bot.drain();
  await itd.close();
}

process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());

bot.on(ChatBotLifecycleEvent.Connect, () => console.log('Бот подключён. Отправьте ему /помощь.'));

try {
  await bot.start();
} catch (error) {
  await stop();
  throw error;
}
