/**
 * Уведомления в реальном времени.
 *
 * Запуск:
 *   ITD_TOKEN=<токен> node guides/events/examples/notifications.mjs
 *
 * Соединение держится само: обрывы, обновление токена и повторные попытки библиотека
 * берёт на себя. Завершение — Ctrl+C.
 */

import {
  ItdClient,
  formatNotificationText,
  resolveNotificationUrl,
} from 'itd-api';

const itd = new ItdClient({ auth: process.env.ITD_TOKEN });
const stream = itd.notifications.events;

stream.on('notification', ({ notification, sound }) => {
  console.log(`\n${sound ? '🔔' : '🔕'} ${formatNotificationText(notification)}`);
  console.log(`   → ${resolveNotificationUrl(notification)}`);
});

stream.on('status', (status) => console.log(`[соединение: ${status}]`));

await stream.connect();
console.log(`Ждём новые уведомления (транспорт: ${stream.transport}). Ctrl+C для выхода.`);

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
