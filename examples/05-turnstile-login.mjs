/**
 * Полностью автоматический вход: токен капчи добывается сам.
 *
 * Запуск:
 *   ITD_EMAIL=you@example.com ITD_PASSWORD=secret node examples/05-turnstile-login.mjs
 *
 * Отличие от примера 02 — там токен капчи приходится добывать руками и передавать
 * в ITD_TURNSTILE. Здесь его берёт `itd-api-turnstile`: поднимает браузер, забирает токен
 * и закрывается. Установите отдельно, основному пакету он не нужен:
 *
 *   npm i itd-api-turnstile playwright
 *   npx playwright install chromium
 *
 * Браузер открывается с окном — так виджет проходится надёжнее. На сервере без графической
 * оболочки запускайте через `xvfb-run -a node examples/05-turnstile-login.mjs`.
 */

import { FileTokenStorage, ItdClient, isItdApiError } from 'itd-api/node';
import { createTurnstileSolver } from 'itd-api-turnstile';

const itd = new ItdClient({
  // Сессия переживает перезапуск, поэтому браузер поднимется только в первый раз —
  // дальше клиент продлевает токен сам и до входа по паролю дело не доходит.
  storage: new FileTokenStorage('./.itd-session.json'),

  auth: {
    email: process.env.ITD_EMAIL,
    password: process.env.ITD_PASSWORD,

    // Функция, а не готовая строка: токен одноразовый и живёт несколько минут, поэтому
    // клиент спрашивает свежий перед каждой попыткой входа — в том числе через сутки,
    // когда сессия истечёт и понадобится войти заново.
    getTurnstileToken: createTurnstileSolver({
      logger: (message) => console.log(`[turnstile] ${message}`),
    }),
  },
});

itd.on('signIn', () => console.log('Вход выполнен, сессия сохранена'));

try {
  const me = await itd.users.me();
  console.log(`Вошли как @${me.username}`);

  for await (const item of itd.posts.iterate({ tab: 'following' })) {
    console.log(`@${item.author.username}: ${item.content.slice(0, 60)}`);
    break;
  }
} catch (error) {
  // Если аккаунт требует подтверждения кодом из письма, автоматический вход невозможен —
  // клиент скажет об этом отдельно и предложит itd.auth.signInWithOtp().
  console.error(isItdApiError(error) ? `${error.code}: ${error.message}` : error);
  process.exitCode = 1;
}
