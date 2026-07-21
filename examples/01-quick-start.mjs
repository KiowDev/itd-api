/**
 * Быстрый старт: чтение ленты и реакция на пост.
 *
 * Запуск:
 *   ITD_TOKEN=<ваш accessToken> node examples/01-quick-start.mjs
 *
 * Где взять токен: откройте итд.com, войдите, затем в консоли браузера выполните
 * запрос к /api/v1/auth/refresh — либо воспользуйтесь примером 02, который входит
 * по логину и паролю.
 */

import { FeedTab, ItdClient, isItdApiError } from 'itd-api';

const itd = new ItdClient({
  // Опции допускают undefined, поэтому переменную окружения можно передавать напрямую.
  auth: process.env.ITD_TOKEN,
});

try {
  const me = await itd.users.me();
  console.log(`Вы вошли как ${me.displayName} (@${me.username})`);
  console.log(`Подписчиков: ${me.followersCount}, записей: ${me.postsCount}\n`);

  // Одна страница ленты.
  const page = await itd.posts.list({ tab: FeedTab.Popular, limit: 5 });

  for (const post of page.items) {
    const text = post.content.slice(0, 60).replace(/\n/g, ' ');
    console.log(`${post.author.avatar} @${post.author.username}: ${text}`);
    console.log(`   ❤ ${post.likesCount}  💬 ${post.commentsCount}  🔁 ${post.repostsCount}`);
  }

  // Перебор нескольких страниц: курсоры подставляются сами.
  console.log('\nПервые 12 записей из подписок:');

  const posts = await itd.posts.iterate({ tab: FeedTab.Following }).collect(12);
  console.log(`получено ${posts.length}`);
} catch (error) {
  if (isItdApiError(error)) {
    console.error(`Ошибка API [${error.code}] ${error.status}: ${error.message}`);
    if (Object.keys(error.fieldErrors).length > 0) console.error(error.fieldErrors);
  } else {
    throw error;
  }
}
