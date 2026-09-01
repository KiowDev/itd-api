/**
 * Проверка солвера вживую. Учётные данные не нужны.
 *
 * Нужен установленный драйвер браузера — в devDependencies его нет намеренно, чтобы
 * обычная установка не тянула сборку браузера ради ручного скрипта:
 *
 *   npm i --no-save patchright && npx patchright install chromium
 *
 *   node scripts/smoke.mjs              — решить активную капчу (её выбирает сервер)
 *   node scripts/smoke.mjs --itd        — принудительно капчу ИТД
 *   node scripts/smoke.mjs --turnstile  — принудительно Cloudflare Turnstile
 *   node scripts/smoke.mjs --both       — обе подряд
 *   node scripts/smoke.mjs --verify     — ещё и убедиться, что сервер принимает токен
 *   node scripts/smoke.mjs --headless   — проверить безоконный режим
 *
 * Проверка отправляет один запрос входа с заведомо несуществующим адресом. Ответ различает
 * ровно то, что нужно: `INVALID_CREDENTIALS` означает, что до проверки пароля дело дошло,
 * то есть капчу сервер принял. Отказ по самой капче выглядит иначе — `TURNSTILE_VERIFICATION_FAILED`.
 */

import { solveCaptcha, CaptchaType } from '@itd-api/captcha';

const BASE_URL = 'https://xn--d1ah4a.com';

/** Поле тела запроса по умолчанию для каждого провайдера — то же знание, что и у `itd-api`. */
const FIELDS = {
  [CaptchaType.Itd]: 'token',
  [CaptchaType.Cloudflare]: 'turnstileToken',
};

const headless = process.argv.includes('--headless');
const verify = process.argv.includes('--verify');

const chosen = process.argv.includes('--both')
  ? [CaptchaType.Itd, CaptchaType.Cloudflare]
  : process.argv.includes('--itd')
    ? [CaptchaType.Itd]
    : process.argv.includes('--turnstile')
      ? [CaptchaType.Cloudflare]
      : null;

console.log(`Режим: ${headless ? 'без окна' : 'с окном'}. Браузер сейчас откроется.\n`);

let ok = true;

// Активную капчу выбирает сервер: спрашиваем его и решаем то, что он назвал.
const targets = chosen ?? [await activeProvider()];

for (const type of targets) {
  const token = await timed(type, () =>
    solveCaptcha(type, { headless, logger: (m) => console.log(`  ${m}`) }),
  );
  if (verify) ok = (await checkSignIn(token, FIELDS[type] ?? 'token')) && ok;
}

if (!verify) {
  console.log('\nЗапустите с --verify, чтобы проверить, принимает ли токен сервер.');
}

process.exit(ok ? 0 : 1);

/** Спрашивает у сервера активного провайдера — ровно так же, как это делает клиент `itd-api`. */
async function activeProvider() {
  const response = await fetch(`${BASE_URL}/api/v1/auth/captcha/provider`, {
    headers: { accept: 'application/json' },
  });
  const body = await response.json().catch(() => ({}));

  if (!response.ok || typeof body?.provider !== 'string') {
    console.error(`Не удалось узнать активного провайдера (HTTP ${response.status}).`);
    process.exit(2);
  }

  // Поле сервер тоже называет сам: имя может смениться, и тогда оно важнее умолчания.
  if (typeof body.field === 'string' && body.field !== '') FIELDS[body.provider] = body.field;
  console.log(`Активный провайдер: ${body.provider}, поле ${FIELDS[body.provider]}.\n`);

  return body.provider;
}

async function timed(label, run) {
  const startedAt = Date.now();
  const token = await run();
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`\n[${label}] токен за ${elapsed} с: ${token.slice(0, 32)}… (${token.length} символов)`);
  return token;
}

/**
 * Пробует войти с полученным токеном. Адрес случайный: аккаунта с ним нет, поэтому дальше
 * проверки пароля запрос не проходит и ничего не меняет. Письма такой запрос не шлёт.
 */
async function checkSignIn(token, field) {
  const email = `itd-api-smoke-${Math.random().toString(36).slice(2)}@gmail.com`;

  const response = await fetch(`${BASE_URL}/api/v1/auth/sign-in`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Origin: BASE_URL,
      Referer: `${BASE_URL}/login`,
    },
    body: JSON.stringify({ email, password: 'smoke-test-not-a-real-password', [field]: token }),
  });

  const body = await response.json().catch(() => ({}));
  const code = body?.error?.code ?? `HTTP ${response.status}`;

  const accepted = code === 'INVALID_CREDENTIALS';
  console.log(`  вход (${field}): ${code} — капча ${accepted ? 'принята ✅' : 'не принята ❌'}`);
  return accepted;
}
