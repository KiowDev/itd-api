/**
 * Проверка связок «драйвер + браузер» вживую. Учётные данные не нужны.
 *
 * Виджет пропускает не всякий браузер, и набор рабочих связок со временем меняется —
 * этим скриптом таблица совместимости в README пересобирается заново.
 *
 *   node scripts/drivers.mjs                          — проверить все известные драйверы
 *   node scripts/drivers.mjs patchright playwright    — только названные
 *   node scripts/drivers.mjs playwright --headless    — без окна
 *   node scripts/drivers.mjs playwright --chrome      — на установленном Google Chrome
 *   node scripts/drivers.mjs playwright --exec=C:\...\chrome.exe   — на своей сборке
 *   node scripts/drivers.mjs playwright --timeout=30000            — свой срок ожидания, мс
 *
 * Драйверы ставятся отдельно и только на время проверки, в зависимости пакета им не место:
 *
 *   npm i --no-save patchright playwright rebrowser-playwright playwright-extra \
 *     puppeteer-extra-plugin-stealth camoufox-js
 *
 * Ненайденный драйвер пропускается, поэтому ставить их все необязательно.
 */

import { launchBrowser, solveTurnstile, TurnstileFailure } from '@itd-api/turnstile';

/**
 * Что проверяется.
 *
 * Драйверы с обычным API поднимает сам пакет — так проверка идёт по тому же коду и с теми же
 * флагами, что достаются пользователю, и повторять здесь набор флагов не нужно. Остальным
 * нужен свой запуск, и он описан рядом.
 */
const DRIVERS = {
  patchright: {},
  playwright: {},
  'playwright-core': {},
  'rebrowser-playwright': {},
  'playwright-extra': {
    launch: async (options) => {
      const { chromium } = await import('playwright-extra');
      const stealth = (await import('puppeteer-extra-plugin-stealth')).default;
      chromium.use(stealth());
      return chromium.launch(options);
    },
  },
  camoufox: {
    // Отпечаток Camoufox собирает сам, и навязанный контекст ему мешает.
    contextOptions: {},
    launch: async (options) => {
      const { Camoufox } = await import('camoufox-js');
      return Camoufox({ headless: options.headless, humanize: true });
    },
  },
};

const flag = (name) =>
  process.argv.find((argument) => argument.startsWith(`${name}=`))?.slice(name.length + 1);

const asked = process.argv.slice(2).filter((argument) => !argument.startsWith('--'));
const headless = process.argv.includes('--headless');
const channel = process.argv.includes('--chrome') ? 'chrome' : undefined;
const executablePath = flag('--exec');
const timeout = Number(flag('--timeout') ?? 40_000);

const unknown = asked.filter((name) => !(name in DRIVERS));
if (unknown.length > 0) {
  console.error(`Неизвестный драйвер: ${unknown.join(', ')}`);
  console.error(`Известные: ${Object.keys(DRIVERS).join(', ')}`);
  process.exit(2);
}

const launchOptions = {
  headless,
  ...(executablePath ? { executablePath } : {}),
  ...(channel ? { channel } : {}),
};

const names = asked.length > 0 ? asked : Object.keys(DRIVERS);
const results = [];

for (const name of names) {
  const { launch, contextOptions } = DRIVERS[name];
  let browser;
  const startedAt = Date.now();

  try {
    // Браузер поднимается здесь, а не внутри solveTurnstile, чтобы отличить отсутствие
    // драйвера от отказа виджета и показать версию браузера даже при успехе.
    browser = launch
      ? await launch(launchOptions)
      : await launchBrowser({ ...launchOptions, driver: name });
  } catch (error) {
    const missing =
      error?.reason === TurnstileFailure.DriverMissing ||
      /Cannot find (package|module)/i.test(String(error));
    results.push([name, missing ? '— не установлен' : `— не запустился: ${brief(error)}`]);
    continue;
  }

  const version = safeVersion(browser);

  try {
    const token = await solveTurnstile({
      browser,
      timeout,
      attempts: 1,
      ...(contextOptions ? { contextOptions } : {}),
    });
    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    results.push([name, `✅ токен за ${seconds} с (${token.length} символов), браузер ${version}`]);
  } catch (error) {
    const code = error?.widgetCode ? `, код ${error.widgetCode}` : '';
    results.push([name, `❌ токена нет${code}, браузер ${version}`]);
  } finally {
    await browser.close().catch(() => {});
  }
}

function safeVersion(browser) {
  try {
    return browser.version?.() ?? 'версия неизвестна';
  } catch {
    return 'версия неизвестна';
  }
}

function brief(error) {
  return String(error?.message ?? error)
    .split('\n')[0]
    .slice(0, 100);
}

const mode = [headless ? 'без окна' : 'с окном', channel ? 'Google Chrome' : undefined]
  .filter(Boolean)
  .join(', ');

console.log(`\nРежим: ${mode}${executablePath ? `, сборка ${executablePath}` : ''}\n`);
for (const [name, outcome] of results) console.log(`  ${name.padEnd(22)} ${outcome}`);
console.log();

process.exit(results.some(([, outcome]) => outcome.startsWith('✅')) ? 0 : 1);
