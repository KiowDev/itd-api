/**
 * Скрытое сообщение в обычном посте.
 *
 * Запуск:
 *   ITD_TOKEN=<accessToken> node guides/plugins/examples/crypto.mjs
 *
 * Плагин лежит в отдельном пакете — основному он не нужен:
 *
 *   npm i @itd-api/crypto
 *
 * Пример публикует пост, читает его обратно **с сервера** и сравнивает результат.
 * Смысл именно в обратном чтении: сервер итд.com нормализует текст поста при сохранении,
 * и проверить, что нагрузка это пережила, можно только на живом API.
 */

import { ItdClient, isItdApiError } from 'itd-api';
import { crypt } from '@itd-api/crypto';

const SECRET = 'секретный текст: 🦎 привет из @itd-api/crypto';
const CONTENT = `обычный пост: ${SECRET}`;
const OFFSET = CONTENT.indexOf(SECRET);

const itd = new ItdClient({ auth: process.env.ITD_TOKEN });

// Одна строка — и шифрование доступно во всех методах, принимающих текст.
itd.use(crypt());

try {
  const created = await itd.posts.create({
    content: CONTENT,
    spans: [{ type: 'crypto', cipher: 'invisible', offset: OFFSET, length: SECRET.length }],
  });
  console.log(`Опубликован пост ${created.id}`);

  // Читаем с сервера, а не берём ответ на публикацию: интересно именно то,
  // что сохранилось после нормализации.
  const post = await itd.posts.get(created.id);

  console.log(`Ответ:      ${post.content}`);
  console.log(`Раскрыто:   ${post.decoded?.content?.text ?? '— ничего не нашлось —'}`);
  console.log(`Длина ответа: ${post.content.length} позиций UTF-16`);

  console.log(
    post.decoded?.content?.text === CONTENT
      ? '✔ сообщение пережило сохранение на сервере'
      : '✘ сообщение потерялось — формат разошёлся с тем, что делает сервер',
  );

  // Прибираем за собой: пост нужен был только для проверки.
  await itd.posts.remove(created.id);
  console.log('Пост удалён');
} catch (error) {
  console.error(isItdApiError(error) ? `${error.code}: ${error.message}` : error);
  process.exitCode = 1;
}
