/**
 * Бот на Node: вход по логину и паролю, сохранение сессии, публикация с опросом.
 *
 * Запуск:
 *   ITD_EMAIL=you@example.com ITD_PASSWORD=secret node examples/02-bot-with-session.mjs
 *
 * Сессия сохраняется в `.itd-session.json`, поэтому при следующем запуске повторный вход
 * не понадобится. Добавьте этот файл в .gitignore — в нём лежат токены.
 */

import { createInterface } from 'node:readline/promises';
import { FileTokenStorage, ItdClient, isItdApiError } from 'itd-api/node';

const itd = new ItdClient({
  auth: { email: process.env.ITD_EMAIL, password: process.env.ITD_PASSWORD },

  // Без хранилища бот входил бы заново при каждом запуске, а серия входов подряд
  // может привести к временной блокировке аккаунта.
  storage: new FileTokenStorage('./.itd-session.json'),

  // Ограничение нагрузки: запросы уходят не залпом, а ровным потоком.
  rateLimit: { concurrency: 4, rps: 8 },

  // logger: true, // раскомментируйте, чтобы видеть каждый запрос (токены маскируются)
});

// Сессия истекла и продлить её не удалось — здесь стоит уведомить владельца бота.
itd.on('authError', () => console.error('Сессия потеряна, нужен повторный вход'));

/** Вход с подтверждением кодом, если сервер его запросил. */
async function ensureSignedIn() {
  try {
    return await itd.users.me();
  } catch (error) {
    if (!isItdApiError(error) || error.status !== 401) throw error;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    await itd.auth.signInWithOtp({
      email: process.env.ITD_EMAIL,
      password: process.env.ITD_PASSWORD,
      getOtp: () => rl.question('Код из письма: '),
    });
  } finally {
    rl.close();
  }

  return itd.users.me();
}

const me = await ensureSignedIn();
console.log(`Вошли как @${me.username}\n`);

// Публикация с опросом. Файл загрузится сам, порядок вложений сохранится.
const post = await itd.posts.create((p) =>
  p
    .content('Собираю мнения')
    .poll((q) => q.question('Какой язык удобнее?').options('TypeScript', 'JavaScript')),
);

console.log(`Опубликовано: ${post.id}`);

// Пример с картинкой — раскомментируйте, подставив существующий путь:
// await itd.posts.create((p) => p.content('смотрите').attach('./photo.jpg'));

// Обход подписок и реакция на непонравившиеся записи.
let liked = 0;

for await (const item of itd.posts.iterate({ tab: 'following' })) {
  if (liked >= 5) break;
  if (item.isLiked || item.isOwner) continue;

  await itd.posts.like(item.id);
  liked += 1;
  console.log(`❤ @${item.author.username}: ${item.content.slice(0, 40)}`);
}

console.log(`\nПоставлено реакций: ${liked}`);
