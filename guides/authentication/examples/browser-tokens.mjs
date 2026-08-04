/**
 * Вход без капчи: токены берутся из браузера, где вы уже авторизованы.
 *
 * Запуск:
 *   ITD_ACCESS_TOKEN=eyJ... ITD_REFRESH_TOKEN=... \
 *     node guides/authentication/examples/browser-tokens.mjs
 *
 * Где их взять (один раз):
 *   1. Откройте итд.com и войдите в аккаунт.
 *   2. DevTools (F12) → Network → любой запрос к /api/… → Request Headers →
 *      `authorization: Bearer eyJ…`. Всё после `Bearer ` — ITD_ACCESS_TOKEN.
 *   3. DevTools → Application (в Firefox — Storage) → Cookies → https://итд.com →
 *      значение cookie `refresh_token` — это ITD_REFRESH_TOKEN.
 *
 * Turnstile здесь не участвует: капча нужна только самому входу по паролю, а он уже
 * выполнен в браузере. Дальше сессия продлевается сама и складывается в `.itd-session.json`,
 * так что копировать токены во второй раз не придётся. Добавьте файл в .gitignore.
 *
 * Важно: продление гасит предыдущий refresh-токен. Если этой же сессией пользуется
 * открытая вкладка, она разлогинится — для бота заведите отдельный вход (приватное окно).
 */

import { ItdClient, isItdApiError } from 'itd-api';
import { FileTokenStorage } from 'itd-api/node';

const accessToken = process.env.ITD_ACCESS_TOKEN;
const refreshToken = process.env.ITD_REFRESH_TOKEN;

if (!accessToken && !refreshToken) {
  throw new Error('Нужен ITD_ACCESS_TOKEN, ITD_REFRESH_TOKEN или оба');
}

const itd = new ItdClient({
  // Хранилище важнее конфигурации: как только клиент продлит сессию, дальше он будет
  // работать с сохранёнными токенами, а не с этими переменными окружения.
  storage: new FileTokenStorage('./.itd-session.json'),

  // Без refresh-токена сессию будет нечем продлить: когда access token истечёт,
  // придёт событие authError.
  ...(accessToken ? { auth: { accessToken, refreshToken } } : {}),
});

itd.on('authError', ({ error }) =>
  console.error('Сессия потеряна:', isItdApiError(error) ? error.code : error),
);

// Только refresh-токен: access token клиент получит сам, продлив сессию.
if (!accessToken) {
  await itd.setSession({ refreshToken });
  await itd.auth.refresh();
}

const { authenticated, banned, user } = await itd.auth.check();

if (!authenticated) {
  console.error('Токен не подошёл: он истёк или сессия отозвана. Скопируйте токены заново.');
  process.exit(1);
}

console.log(`Вошли как @${user.username}${banned ? ' (аккаунт заблокирован)' : ''}`);

// Список своих сессий: у текущей isCurrent === true. Лишние снимаются revokeSession(id).
for (const session of await itd.auth.sessions()) {
  const where = [session.clientName, session.osName, session.ipCity].filter(Boolean).join(', ');
  console.log(`${session.isCurrent ? '→' : ' '} ${where || session.deviceType} · ${session.lastUsedAt}`);
}

await itd.close();
