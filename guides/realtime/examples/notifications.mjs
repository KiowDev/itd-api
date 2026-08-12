/**
 * Уведомления в реальном времени.
 *
 * Запуск:
 *   ITD_TOKEN=<токен> node guides/realtime/examples/notifications.mjs
 *
 * Соединение держится само: обрывы, обновление токена и повторные попытки библиотека
 * берёт на себя. Завершение — Ctrl+C.
 */

import {
  ItdClient,
  NotificationUpdateType,
  formatNotificationText,
  resolveNotificationUrl,
} from 'itd-api';

const itd = new ItdClient({
  auth: process.env.ITD_TOKEN,
  events: { notifications: { syncCount: false } },
});

// Сначала — то, что уже накопилось.
const history = await itd.notifications.list({ limit: 5 });
let unread = await itd.notifications.count();

console.log(`Непрочитанных: ${unread}`);
console.log('\nПоследние уведомления:');

for (const notification of history.items) {
  const mark = notification.isRead ? ' ' : '•';
  console.log(`${mark} ${formatNotificationText(notification)}`);
  console.log(`  → ${resolveNotificationUrl(notification)}`);
}

// Теперь поток новых.
// Начальный счётчик уже получен выше, поэтому повторный REST-запрос при connect не нужен.
const stream = itd.notifications.events;

stream.onUpdate(NotificationUpdateType.Notification, ({ update }) => {
  const { notification, sound, unreadCount } = update.data;

  console.log(`\n${sound ? '🔔' : '🔕'} ${formatNotificationText(notification)}`);
  console.log(`   → ${resolveNotificationUrl(notification)}`);

  // Объекты из списка и из потока имеют одинаковую форму — их можно складывать вместе.
  history.items.unshift(notification);
  unread = unreadCount ?? unread + 1;
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

let closing = false;

async function close() {
  if (closing) return;
  closing = true;

  try {
    await itd.close();
    console.log('\nОтключено');
  } catch (error) {
    console.error('\nНе удалось корректно завершить клиент:', error);
    process.exitCode = 1;
  }
}

process.once('SIGINT', () => void close());
process.once('SIGTERM', () => void close());
