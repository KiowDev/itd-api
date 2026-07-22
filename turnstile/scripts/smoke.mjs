/**
 * Проверка солвера вживую. Учётные данные не нужны.
 *
 *   node scripts/smoke.mjs             — только добыть токен
 *   node scripts/smoke.mjs --verify    — ещё и убедиться, что сервер его принимает
 *   node scripts/smoke.mjs --headless  — проверить безоконный режим
 *
 * Второй шаг отправляет один запрос входа с заведомо несуществующим адресом. Ответ
 * различает ровно то, что нужно: `INVALID_CREDENTIALS` означает, что до проверки пароля
 * дело дошло, то есть капчу сервер принял. Отказ по самой капче выглядит иначе.
 */

import { solveTurnstile } from 'itd-api-turnstile';

const BASE_URL = 'https://xn--d1ah4a.com';

const headless = process.argv.includes('--headless');
const verify = process.argv.includes('--verify');

console.log(`Режим: ${headless ? 'без окна' : 'с окном'}. Браузер сейчас откроется.\n`);

const startedAt = Date.now();

const token = await solveTurnstile({
  headless,
  logger: (message) => console.log(`  ${message}`),
});

const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
console.log(`\nТокен получен за ${elapsed} с: ${token.slice(0, 32)}… (${token.length} символов)`);

if (!verify) {
  console.log('\nЗапустите с --verify, чтобы проверить, принимает ли токен сервер.');
  process.exit(0);
}

// Адрес случайный: аккаунта с ним нет, поэтому дальше проверки пароля запрос не пройдёт
// и ничего не изменит. Письма такой запрос тоже не отправляет.
const email = `itd-api-smoke-${Math.random().toString(36).slice(2)}@example.invalid`;

const response = await fetch(`${BASE_URL}/api/v1/auth/sign-in`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Origin: BASE_URL,
    Referer: `${BASE_URL}/`,
  },
  body: JSON.stringify({ email, password: 'smoke-test-not-a-real-password', turnstileToken: token }),
});

const body = await response.json().catch(() => ({}));
const code = body?.error?.code ?? `HTTP ${response.status}`;

console.log(`\nОтвет сервера: ${code}`);

if (code === 'INVALID_CREDENTIALS') {
  console.log('Токен принят: сервер проверил капчу и дошёл до пароля. Солвер работает.');
  process.exit(0);
}

if (String(code).includes('TURNSTILE') || code === 'VALIDATION_ERROR') {
  console.error('Токен отвергнут — капча не прошла. Проверьте sitekey и origin.');
  console.error(JSON.stringify(body, null, 2));
  process.exit(1);
}

console.error('Неожиданный ответ. Разберите его вручную:');
console.error(JSON.stringify(body, null, 2));
process.exit(1);
