/**
 * Уведомления в реальном времени.
 *
 * Запуск:
 *   ITD_TOKEN=<ваш accessToken> node examples/03-realtime-notifications.mjs
 *
 * Соединение держится само: обрывы, обновление токена и повторные попытки библиотека
 * берёт на себя. Завершение — Ctrl+C.
 */

import { ItdClient, formatNotificationText, resolveNotificationUrl } from 'itd-api';

const itd = new ItdClient({ auth: process.env.ITD_TOKEN });

// Сначала — то, что уже накопилось.
const history = await itd.notifications.list({ limit: 5 });

console.log(`Непрочитанных: ${await itd.notifications.count()}`);
console.log('\nПоследние уведомления:');

for (const notification of history.items) {
  const mark = notification.isRead ? ' ' : '•';
  console.log(`${mark} ${formatNotificationText(notification)}`);
  console.log(`  → ${resolveNotificationUrl(notification)}`);
}

// Теперь поток новых.
const stream = itd.realtime();

stream.on('notification', ({ notification, sound }) => {
  console.log(`\n${sound ? '🔔' : '🔕'} ${formatNotificationText(notification)}`);
  console.log(`   → ${resolveNotificationUrl(notification)}`);

  // Объекты из списка и из потока имеют одинаковую форму — их можно складывать вместе.
  history.items.unshift(notification);
});

// Счётчик непрочитанных сервер по потоку не присылает — ведём его сами.
let unread = await itd.notifications.count();

stream.on('notification', () => {
  unread += 1;
  console.log(`   непрочитанных: ${unread}`);
});

stream.on('ready', ({ userId }) => console.log(`[поток подтвердил получателя ${userId}]`));
stream.on('status', (status) => console.log(`[соединение: ${status}]`));
stream.on('reconnect', ({ attempt, delay }) => {
  console.log(`[переподключение №${attempt} через ${delay} мс]`);
});
stream.on('giveup', () => {
  console.error('[попытки исчерпаны, соединение восстановится только вручную]');
});

await stream.connect();
console.log(`\nЖдём события (транспорт: ${stream.transport}). Ctrl+C для выхода.`);

process.on('SIGINT', () => {
  stream.disconnect();
  console.log('\nОтключено');
  process.exit(0);
});
