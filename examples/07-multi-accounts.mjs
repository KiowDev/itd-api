/**
 * Несколько аккаунтов в одном процессе: общее хранилище сессий, свой токен у каждого.
 *
 * Запуск:
 *   ITD_TOKENS='бот-1=<accessToken>,бот-2=<accessToken>' node examples/07-multi-accounts.mjs
 *
 * Первый запуск заводит аккаунты по токенам и складывает их сессии в `.itd-sessions.json`.
 * При следующих ITD_TOKENS уже не нужен: restore() поднимет всех из файла, а истёкшие
 * токены библиотека продлит сама. Файл в .gitignore — в нём лежат токены доступа.
 */

import { FileMultiTokenStorage, ItdAccounts, isItdApiError } from 'itd-api/node';

await using accounts = new ItdAccounts({
  storage: new FileMultiTokenStorage('./.itd-sessions.json'),

  // Ограничение нагрузки. Лимиты итд.com считаются по аккаунту, поэтому очередь
  // по умолчанию у каждого своя. Если все аккаунты ходят с одного IP и упираются
  // в ограничение по адресу — добавьте rateLimitScope: 'shared'.
  rateLimit: { concurrency: 4, rps: 8 },

  // logger: true, // раскомментируйте, чтобы видеть каждый запрос (токены маскируются)
});

// Обработчик один на всех: в полезной нагрузке приходит имя аккаунта.
accounts.on('authError', ({ account, error }) =>
  console.error(`[${account}] сессия потеряна:`, isItdApiError(error) ? error.code : error),
);

// Поднимаем тех, кто уже входил раньше, — ни токена, ни капчи для этого не нужно.
const restored = await accounts.restore();
if (restored.length > 0) console.log(`Из хранилища: ${restored.join(', ')}`);

// Новые аккаунты — из переменной окружения вида «имя=токен,имя=токен».
for (const pair of (process.env.ITD_TOKENS ?? '').split(',').filter(Boolean)) {
  const [name, token] = pair.split('=');
  if (!name || !token || accounts.has(name)) continue;

  accounts.addAccount(name, { auth: token });
  console.log(`Добавлен: ${name}`);
}

if (accounts.size === 0) {
  throw new Error('Ни одного аккаунта: передайте ITD_TOKENS при первом запуске');
}

// Клиент аккаунта — обычный ItdClient со всеми разделами.
for (const [name, itd] of accounts) {
  // getUserId() читает идентификатор из самого токена и не стоит ни одного запроса.
  const id = await itd.getUserId();

  try {
    const me = await itd.users.me();
    console.log(`${name} → @${me.username} (${id ?? 'id неизвестен'})`);
  } catch (error) {
    console.error(`${name} → не отвечает:`, isItdApiError(error) ? error.code : error);
  }
}

// Действие одним аккаунтом.
const [first] = accounts.names();
const posts = await accounts.account(first).posts.iterate({ tab: 'popular' }).collect(3);
console.log(`\n${first} видит ${posts.length} популярных записей`);

// Убрать аккаунт вместе с сохранённой сессией:
// await accounts.removeAccount('бот-2', { forget: true });
