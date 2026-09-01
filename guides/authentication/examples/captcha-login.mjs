/**
 * Полностью автоматический вход: токен капчи добывается сам.
 *
 * Запуск:
 *   ITD_EMAIL=you@example.com ITD_PASSWORD=secret \
 *     node guides/authentication/examples/captcha-login.mjs
 *
 * В соседнем `bot-with-session.mjs` токен капчи приходится добывать руками. Здесь его берёт
 * `@itd-api/captcha`: поднимает браузер, забирает токен и закрывается. Установите отдельно,
 * основному пакету он не нужен:
 *
 *   npm i @itd-api/captcha patchright
 *   npx patchright install chromium
 *
 * Браузер открывается с окном — так виджет проходится надёжнее. На сервере без графической
 * оболочки запускайте через
 * `xvfb-run -a node guides/authentication/examples/captcha-login.mjs`.
 *
 * Провайдера выбирает сервер: собственная капча ИТД или Cloudflare Turnstile. Клиент
 * спрашивает активного перед входом и просит решить именно его виджет, поэтому вход
 * переживает переключение провайдера без правок кода.
 */

import { ItdClient, isItdApiError } from 'itd-api';
import { FileTokenStorage } from 'itd-api/node';
import { createCaptchaSolver } from '@itd-api/captcha';

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
    captcha: createCaptchaSolver({
      logger: (message) => console.log(`[captcha] ${message}`),
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
