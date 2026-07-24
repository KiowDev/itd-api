/**
 * Создание и отображение поста с разметкой текста.
 *
 * Запуск:
 *   ITD_TOKEN=<ваш accessToken> node guides/text-markup/examples/create-post.mjs
 *
 * Скрипт создаёт один настоящий пост в аккаунте из ITD_TOKEN.
 */

import { ItdClient, SpanType, markup, post, renderSpans } from 'itd-api';

if (!process.env.ITD_TOKEN) {
  throw new Error('Передайте access token в переменной окружения ITD_TOKEN');
}

const itd = new ItdClient({ auth: process.env.ITD_TOKEN });

// Текст и offsets собираются одновременно — вручную считать индексы не нужно.
const created = await itd.posts.create(
  post().markup((m) =>
    m
      .text('Смотрите ')
      .hashtag('котики')
      .text(' от ')
      .mention('durov')
      .newline()
      .bold('Важно')
      .text(': ')
      .link('документация', 'https://example.com/docs'),
  ),
);

console.log(`Создан пост ${created.id}`);
console.log('HTML:', renderSpans(created.content, created.spans));
console.log(
  'Markdown:',
  renderSpans(created.content, created.spans, { format: 'markdown' }),
);

// Для готового обычного текста можно найти ссылки, хэштеги и упоминания автоматически.
const detected = post('#котики от @durov: https://example.com').autoSpans().build();
console.log('\nautoSpans():', detected);

// Один фрагмент может иметь несколько стилей; вложенность задаёт пересечения.
const layered = markup()
  .styled('жирный и подчёркнутый', SpanType.Bold, SpanType.Underline)
  .newline()
  .bold((m) => m.text('жирный, ').italic('а здесь ещё курсив'))
  .build();
console.log('\nПересекающиеся spans:', layered);

// Важно: новый content сбрасывает spans, рассчитанные для прежнего текста.
const replaced = post('#старый').autoSpans().content('новый текст').build();
console.log('\nПосле content():', replaced);

// Для своих маршрутов и CSS можно настроить HTML-рендер.
console.log(
  '\nНастроенный HTML:',
  renderSpans(created.content, created.spans, {
    mentionUrl: (username) => `/users/${username}`,
    hashtagUrl: (tag) => `/topics/${tag}`,
    classPrefix: 'feed',
  }),
);
