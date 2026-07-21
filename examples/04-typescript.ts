/**
 * TypeScript: типы, билдеры и разбор ошибок.
 *
 * Запуск:
 *   npx tsx examples/04-typescript.ts
 */

import {
  FeedTab,
  ItdClient,
  ItdValidationError,
  type Notification,
  type Post,
  ReportReason,
  isItdApiError,
  ItdErrorCode,
  ItdRateLimitError,
  poll,
  post,
  report,
} from 'itd-api';

const itd = new ItdClient({ auth: process.env.ITD_TOKEN });

// ── Перечисления вместо магических строк ────────────────────────────────────────
// Работают обе формы: константа и обычная строка.
await itd.posts.list({ tab: FeedTab.Popular });
await itd.posts.list({ tab: 'following' });

// ── Заготовки билдеров переиспользуются ─────────────────────────────────────────
// Билдер неизменяемый, поэтому заготовку не испортить.
const draft = post().content('черновик');

const first: Post = await itd.posts.create(draft.append('первая версия'));
const second: Post = await itd.posts.create(draft.append('вторая версия'));
console.log(first.id, second.id);

// Опрос можно собрать заранее и передать в несколько записей.
const survey = poll('Какой язык удобнее?').options('TypeScript', 'JavaScript').multipleChoice();
await itd.posts.create({ content: 'голосуем', poll: survey });

// ── Пагинация: три способа ──────────────────────────────────────────────────────
// По элементам.
for await (const item of itd.posts.iterate({ tab: FeedTab.Popular })) {
  console.log(item.content);
  break;
}

// По страницам — когда нужны сведения о самой странице.
for await (const page of itd.users.iterateFollowers('durov').pages()) {
  console.log(`${page.items.length} из ${page.total ?? '?'}`);
  break;
}

// Собрать нужное количество и остановиться.
const top: Post[] = await itd.posts.iterate({ tab: FeedTab.Popular }).collect(50);
console.log(`собрано ${top.length}`);

// ── Разбор ошибок ───────────────────────────────────────────────────────────────
try {
  await itd.users.updateMe({ username: 'занятое_имя' });
} catch (error) {
  if (error instanceof ItdValidationError) {
    // Обе формы ошибок API сведены к одной структуре.
    for (const [field, messages] of Object.entries(error.fieldErrors)) {
      console.error(`${field}: ${messages.join(', ')}`);
    }
  } else if (error instanceof ItdRateLimitError) {
    console.error(`Лимит запросов, повтор через ${error.retryAfter ?? '?'} мс`);
  } else if (isItdApiError(error) && error.hasCode(ItdErrorCode.PROFILE_USERNAME_TAKEN)) {
    console.error('Имя уже занято');
  } else {
    throw error;
  }
}

// ── Стена другого пользователя требует UUID ─────────────────────────────────────
// Проверка сработает до обращения к сети и подскажет, где взять идентификатор.
const target = await itd.users.get('durov');
await itd.posts.create((p) => p.content('привет!').onWall(target.id));

// ── Жалоба: тип объекта и его идентификатор нельзя рассогласовать ───────────────
await itd.reports.create(report.post(first.id).reason(ReportReason.Spam));

// ── Уведомления из REST и из потока имеют одну форму ────────────────────────────
const feed: Notification[] = (await itd.notifications.list({ limit: 10 })).items;

const stream = itd.realtime();
stream.on('notification', ({ notification }) => feed.unshift(notification));
await stream.connect();
