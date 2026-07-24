/**
 * Запуск:
 *   ITD_TOKEN=<accessToken> ITD_POST_ID=<postId> \
 *     node guides/plugins/examples/cache.mjs
 */

import { cache } from '@itd-api/cache';
import { ItdClient } from 'itd-api';

const token = process.env.ITD_TOKEN;
const postId = process.env.ITD_POST_ID;

if (!token || !postId) {
  throw new Error('Передайте ITD_TOKEN и ITD_POST_ID');
}

const itd = new ItdClient({ auth: token });
const cached = cache({
  ttl: 60_000,
  routes: ['posts.get', 'users.get'],
});

itd.use(cached);

try {
  const first = await itd.posts.get(postId);
  const second = await itd.posts.get(postId);

  console.log(first.content);
  console.log(`Повторный ответ получен из кэша: ${first.id === second.id}`);
} finally {
  await itd.close();
}
