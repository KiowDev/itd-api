import type { Browser, NewContextOptions, Page } from './driver.js';
import { CaptchaError, CaptchaFailure } from './errors.js';
import type { CaptchaHandler } from './handler.js';
import { launchBrowser } from './launch.js';
import type { ResolvedOptions } from './options.js';

/** Разброс координат клика, px в каждую сторону. */
const CLICK_JITTER = 4;
/** Пауза перед первым касанием, мс. */
const HUMAN_DELAY = [1500, 2500] as const;
/** Как часто опрашивается состояние виджета, мс. */
const POLL_INTERVAL = 250;
/** Сколько ждать между повторными кликами, мс. */
const CLICK_INTERVAL = 4000;
/** Сколько ждать появления виджета, мс. */
const WIDGET_APPEAR_TIMEOUT = 15_000;

/** Настройки контекста по умолчанию. Заменяются целиком через `contextOptions`. */
const DEFAULT_CONTEXT_OPTIONS: NewContextOptions = {
  locale: 'ru-RU',
  viewport: { width: 1280, height: 800 },
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const between = (min: number, max: number): number => min + Math.random() * (max - min);

/**
 * Версия браузера для текста ошибки.
 *
 * Сборка Chromium — первое, что стоит проверить при отказе виджета: часть сборок его
 * не проходит. Метода может не быть, если браузер передали свой.
 */
function browserVersion(browser: Browser): string | undefined {
  try {
    return browser.version?.();
  } catch {
    return undefined;
  }
}

/**
 * Кликает по чекбоксу виджета.
 *
 * Чекбокс лежит в iframe чужого происхождения, до его DOM не дотянуться — клик идёт
 * по координатам. Отсчёт ведётся от собственного контейнера известного размера, поэтому
 * попадание не зависит от разметки виджета. Координаты слегка разбрасываются: один и тот же
 * пиксель раз за разом — заметная закономерность.
 */
async function clickCheckbox(page: Page, offsetX: number): Promise<boolean> {
  const widget = await page.$('#widget');
  const box = await widget?.boundingBox();
  if (!box) return false;

  const x = box.x + offsetX + between(-CLICK_JITTER, CLICK_JITTER);
  const y = box.y + box.height / 2 + between(-CLICK_JITTER, CLICK_JITTER);

  await page.mouse.move(x, y, { steps: 8 });
  await page.mouse.click(x, y, { delay: between(40, 110) });
  return true;
}

/** Ждёт токен, периодически подталкивая виджет кликом. */
async function waitForToken(
  page: Page,
  handler: CaptchaHandler,
  options: ResolvedOptions,
  browser: Browser,
): Promise<string> {
  const deadline = Date.now() + options.timeout;

  // Ожидание разметки необязательное: виджет её меняет, и привязываться жёстко нельзя.
  // Настоящий срок задаёт цикл ниже.
  await page
    .waitForSelector(handler.widgetReadySelector, {
      timeout: Math.min(WIDGET_APPEAR_TIMEOUT, options.timeout),
      state: 'attached',
    })
    .catch(() => {});

  // Первый клик не мгновенный: мгновенное касание только что отрисованного виджета само
  // по себе признак автоматизации, а капча ИТД к тому же измеряет время до клика.
  let nextClickAt = Date.now() + between(HUMAN_DELAY[0], HUMAN_DELAY[1]);
  let lastError: string | undefined;

  while (Date.now() < deadline) {
    const state = await handler.readState(page);

    if (state.token) {
      options.logger?.('токен получен');
      return state.token;
    }

    if (state.error && state.error !== lastError) {
      if (handler.isPermanentWidgetError(state.error)) {
        throw new CaptchaError(
          CaptchaFailure.WidgetError,
          `Виджет ${handler.label} отказал для домена ${options.origin} (код ${state.error}): ` +
            'ключ не разрешён для этого домена.',
          { type: handler.type, widgetCode: state.error },
        );
      }

      // Прочие коды временные: обрывать попытку рано, виджет пробует снова сам.
      lastError = state.error;
      options.logger?.(`виджет сообщил об ошибке ${state.error}, ждём повтора`);
    }

    if (Date.now() >= nextClickAt && (await clickCheckbox(page, handler.checkboxOffsetX))) {
      options.logger?.('клик по чекбоксу');
      nextClickAt = Date.now() + CLICK_INTERVAL;
    }

    await sleep(POLL_INTERVAL);
  }

  const version = browserVersion(browser);

  throw new CaptchaError(
    CaptchaFailure.Timeout,
    `Виджет ${handler.label} не отдал токен за ${options.timeout} мс` +
      (lastError ? `; последняя ошибка виджета — ${lastError}` : '') +
      (version ? `; браузер — ${version}` : '') +
      '. Рабочие связки драйвера и браузера перечислены в README пакета.',
    lastError ? { type: handler.type, widgetCode: lastError } : { type: handler.type },
  );
}

async function solveOnce(
  browser: Browser,
  handler: CaptchaHandler,
  options: ResolvedOptions,
): Promise<string> {
  // Каждая попытка идёт в чистом контексте: cookie и хранилище от неудачной попытки
  // достались бы следующей, а виджет их учитывает.
  const context = await browser.newContext(options.contextOptions ?? DEFAULT_CONTEXT_OPTIONS);

  try {
    const page = await context.newPage();
    const url = `${options.origin}/`;
    const body = handler.buildPage({ theme: options.theme });

    // На сайт запроса не уходит: навигация перехватывается и подменяется своей страницей.
    // Домен для браузера при этом настоящий, поэтому виджет проходит его проверку,
    // а сервер при проверке токена видит ожидаемый hostname.
    await page.route(url, (route) =>
      route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body }),
    );
    await page.goto(url, { waitUntil: 'domcontentloaded' });

    return await waitForToken(page, handler, options, browser);
  } finally {
    await context.close().catch(() => {});
  }
}

/** Ошибки настройки: повтор их не исправит. */
function isPermanent(error: unknown): boolean {
  if (!(error instanceof CaptchaError)) return false;
  if (error.reason === CaptchaFailure.DriverMissing) return true;
  if (error.reason === CaptchaFailure.LaunchFailed) return true;
  if (error.reason === CaptchaFailure.BrowserClosed) return true;

  return error.reason === CaptchaFailure.WidgetError;
}

/**
 * Как драйверы сообщают, что страницы, контекста или браузера больше нет.
 *
 * Своего типа ошибки у них нет, поэтому остаётся текст сообщения.
 */
const CLOSED_MARKERS = [
  'has been closed',
  'target closed',
  'browser has been closed',
  'browser has disconnected',
  'session closed',
];

function isClosedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  return CLOSED_MARKERS.some((marker) => message.includes(marker));
}

/** Приводит закрытие браузера к {@link CaptchaError}; остальное отдаёт как есть. */
function toCaptchaError(error: unknown, handler: CaptchaHandler): unknown {
  if (!isClosedError(error)) return error;

  return new CaptchaError(
    CaptchaFailure.BrowserClosed,
    `Браузер закрылся до того, как виджет ${handler.label} отдал токен.`,
    { type: handler.type },
  );
}

/**
 * Общий путь получения токена: поднимает браузер, решает виджет, закрывает браузер.
 *
 * Всё, что зависит от провайдера, приходит в {@link CaptchaHandler}; здесь остаётся только
 * то, что одинаково для любого виджета.
 *
 * @throws {CaptchaError} если токен получить не удалось
 */
export async function runSolver(
  handler: CaptchaHandler,
  options: ResolvedOptions,
): Promise<string> {
  const browser = options.browser ?? (await launchBrowser(options));
  const owned = options.browser === undefined;

  try {
    for (let attempt = 1; attempt <= options.attempts; attempt++) {
      try {
        options.logger?.(`попытка ${attempt} из ${options.attempts}`);
        return await solveOnce(browser, handler, options);
      } catch (raw) {
        const error = toCaptchaError(raw, handler);
        if (isPermanent(error) || attempt === options.attempts) throw error;
        options.logger?.(
          `попытка ${attempt} не удалась: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    // Недостижимо: последняя попытка либо возвращает токен, либо бросает ошибку.
    throw new CaptchaError(CaptchaFailure.Timeout, `Токен ${handler.label} получить не удалось`, {
      type: handler.type,
    });
  } finally {
    if (owned) await browser.close().catch(() => {});
  }
}
