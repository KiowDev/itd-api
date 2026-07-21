/**
 * Бот на Node: вход по логину и паролю, сохранение сессии, публикация с опросом.
 *
 * Запуск:
 *   ITD_EMAIL=you@example.com ITD_PASSWORD=secret ITD_TURNSTILE=... \
 *     node examples/02-bot-with-session.mjs
 *
 * Вход требует токен капчи Cloudflare Turnstile: получите его в браузере на странице входа
 * (ключ виджета — TURNSTILE_SITE_KEY) и передайте в ITD_TURNSTILE. Токен одноразовый
 * и живёт несколько минут, поэтому нужен только при первом запуске.
 *
 * Дальше сессия сохраняется в `.itd-session.json`, и повторный вход не понадобится:
 * библиотека продлевает её сама. Добавьте этот файл в .gitignore — в нём лежат токены.
 */

import { createInterface } from 'node:readline/promises';
import { FileTokenStorage, ItdClient, isItdApiError } from 'itd-api/node';

const itd = new ItdClient({
  // auth здесь не задаём: вход по паролю требует свежей капчи, поэтому он делается
  // явно и только когда сохранённая сессия не подошла — см. ensureSignedIn().

  // Без хранилища бот входил бы заново при каждом запуске, а серия входов подряд
  // может привести к временной блокировке аккаунта.
  storage: new FileTokenStorage('./.itd-session.json'),

  // Ограничение нагрузки: запросы уходят не залпом, а ровным потоком.
  rateLimit: { concurrency: 4, rps: 8 },

  // logger: true, // раскомментируйте, чтобы видеть каждый запрос (токены маскируются)
});

// Сессия истекла и продлить её не удалось — здесь стоит уведомить владельца бота.
// В error лежит ответ сервера: по error.code видно, отозвана сессия или просто истекла.
itd.on('authError', ({ error }) =>
  console.error('Сессия потеряна:', isItdApiError(error) ? error.code : error),
);

/**
 * Работает с сохранённой сессией, а входит заново, только если та не подошла.
 *
 * Отдельная проверка `hasRefreshSession()` не нужна: продление происходит само при 401.
 * Достаточно поймать 401, который пережил и продление тоже.
 */
async function ensureSignedIn() {
  try {
    return await itd.users.me();
  } catch (error) {
    if (!isItdApiError(error) || error.status !== 401) throw error;
  }

  if (!process.env.ITD_TURNSTILE) {
    throw new Error('Сохранённая сессия не подошла — нужен новый токен капчи в ITD_TURNSTILE');
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    await itd.auth.signInWithOtp({
      email: process.env.ITD_EMAIL,
      password: process.env.ITD_PASSWORD,
      turnstileToken: process.env.ITD_TURNSTILE,
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
