import { TurnstileError, TurnstileFailure } from './errors.js';
import { type BrowserOptions, launchBrowser } from './launch.js';
import { buildWidgetPage, type WidgetState } from './page.js';
import type { Browser, Page } from './playwright.js';

/** Базовый URL сайта итд.com. Домен записан в punycode: `итд.com`. */
export const DEFAULT_ORIGIN = 'https://xn--d1ah4a.com';

/**
 * Публичный ключ виджета Turnstile на итд.com.
 *
 * Тот же, что экспортирует `itd-api` под именем `TURNSTILE_SITE_KEY`. Продублирован,
 * чтобы этот пакет не зависел от `itd-api` ради одной строки.
 */
export const ITD_SITE_KEY = '0x4AAAAAACHhxczw6fJGwPBg';

/** Насколько правее края контейнера находится чекбокс виджета, px. */
const CHECKBOX_OFFSET_X = 30;
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
/**
 * Признак того, что виджет отрисовался.
 *
 * Обёртка, а не iframe внутри неё: пройдясь без участия человека, виджет iframe убирает,
 * и ожидание iframe проспало бы уже готовый токен.
 */
const WIDGET_READY_SELECTOR = '#widget > div';
/** Коды Cloudflare вида `110***` означают, что ключ не разрешён для домена. */
const DOMAIN_ERROR_PREFIX = '110';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const between = (min: number, max: number): number => min + Math.random() * (max - min);

/** Настройки получения токена. */
export interface TurnstileOptions extends BrowserOptions {
  /** Сайт, чей виджет решается. По умолчанию {@link DEFAULT_ORIGIN}. */
  origin?: string | undefined;
  /** Публичный ключ виджета. По умолчанию {@link ITD_SITE_KEY}. */
  sitekey?: string | undefined;
  /** Оформление виджета. По умолчанию `auto`. */
  theme?: 'auto' | 'light' | 'dark' | undefined;
  /** Сколько ждать токен, мс. По умолчанию 60000. */
  timeout?: number | undefined;
  /** Сколько попыток делать при неудаче. По умолчанию 2. */
  attempts?: number | undefined;
  /**
   * Готовый браузер. Тогда пакет его не запускает и не закрывает.
   *
   * Пригодится, если браузер уже поднят для чего-то ещё.
   */
  browser?: Browser | undefined;
  /** Куда писать ход решения. Например `console.debug`. */
  logger?: ((message: string) => void) | undefined;
}

interface ResolvedOptions extends TurnstileOptions {
  origin: string;
  sitekey: string;
  theme: 'auto' | 'light' | 'dark';
  timeout: number;
  attempts: number;
}

function resolveOrigin(origin: string): string {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new TypeError(`origin должен быть абсолютным URL, получено: ${origin}`);
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new TypeError(`origin должен быть http или https, получено: ${parsed.protocol}`);
  }

  // Виджет привязан к домену, а не к пути: адрес приводится к корню, чтобы перехват
  // навигации совпал с ним ровно один раз.
  return parsed.origin;
}

function resolveOptions(options: TurnstileOptions): ResolvedOptions {
  const timeout = options.timeout ?? 60_000;
  const attempts = options.attempts ?? 2;

  if (!Number.isFinite(timeout) || timeout <= 0) {
    throw new TypeError(`timeout должен быть положительным числом, получено: ${timeout}`);
  }
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new TypeError(`attempts должен быть целым числом от 1, получено: ${attempts}`);
  }

  return {
    ...options,
    origin: resolveOrigin(options.origin ?? DEFAULT_ORIGIN),
    sitekey: options.sitekey ?? ITD_SITE_KEY,
    theme: options.theme ?? 'auto',
    timeout,
    attempts,
  };
}

/**
 * Читает результат виджета.
 *
 * Источников два. Скрытое поле `cf-turnstile-response` виджет заполняет всегда, а вот
 * `callback` срабатывает не в каждом сценарии: пройдясь сам, виджет успевает убрать iframe,
 * и обработчика можно не дождаться. Поле при этом остаётся заполненным, и лежит оно
 * в нашей странице, а не внутри iframe чужого происхождения, поэтому доступно.
 */
function readState(page: Page): Promise<WidgetState> {
  return page.evaluate<WidgetState>(() => {
    // Функция уезжает в браузер и замыканий с собой не берёт, поэтому селектор вписан
    // строкой, а не вынесен в константу модуля.
    const field = document.querySelector('input[name="cf-turnstile-response"]') as {
      value?: string;
    } | null;
    const scope = window as unknown as { __itdToken?: string | null; __itdError?: string | null };

    // Пустая строка в поле означает «ещё не решено», поэтому проверка на истинность.
    return { token: scope.__itdToken || field?.value || null, error: scope.__itdError ?? null };
  });
}

/**
 * Кликает по чекбоксу виджета.
 *
 * Чекбокс лежит в iframe чужого происхождения, до его DOM не дотянуться — клик идёт
 * по координатам. Отсчёт ведётся от собственного контейнера известного размера, поэтому
 * попадание не зависит от разметки виджета. Координаты слегка разбрасываются: один и тот же
 * пиксель раз за разом — заметная закономерность.
 */
async function clickCheckbox(page: Page): Promise<boolean> {
  const widget = await page.$('#widget');
  const box = await widget?.boundingBox();
  if (!box) return false;

  const x = box.x + CHECKBOX_OFFSET_X + between(-CLICK_JITTER, CLICK_JITTER);
  const y = box.y + box.height / 2 + between(-CLICK_JITTER, CLICK_JITTER);

  await page.mouse.move(x, y, { steps: 8 });
  await page.mouse.click(x, y, { delay: between(40, 110) });
  return true;
}

/** Ждёт токен, периодически подталкивая виджет кликом. */
async function waitForToken(page: Page, options: ResolvedOptions): Promise<string> {
  const deadline = Date.now() + options.timeout;

  // Ожидание разметки необязательное: Cloudflare её меняет, и привязываться жёстко нельзя.
  // Настоящий срок задаёт цикл ниже.
  await page
    .waitForSelector(WIDGET_READY_SELECTOR, {
      timeout: Math.min(WIDGET_APPEAR_TIMEOUT, options.timeout),
      state: 'attached',
    })
    .catch(() => {});

  // Состояние проверяется раньше первого клика: чаще всего виджет проходится сам. Если клик
  // всё же понадобится, то не мгновенный — мгновенное касание только что отрисованного
  // виджета само по себе признак автоматизации.
  let nextClickAt = Date.now() + between(HUMAN_DELAY[0], HUMAN_DELAY[1]);
  let lastError: string | undefined;

  while (Date.now() < deadline) {
    const state = await readState(page);

    if (state.token) {
      options.logger?.('токен получен');
      return state.token;
    }

    if (state.error && state.error !== lastError) {
      if (state.error.startsWith(DOMAIN_ERROR_PREFIX)) {
        throw new TurnstileError(
          TurnstileFailure.WidgetError,
          `Ключ ${options.sitekey} не разрешён для домена ${options.origin} (код ${state.error})`,
          { widgetCode: state.error },
        );
      }

      // Прочие коды временные, и `error-callback` страницы просит виджет попробовать снова.
      // Обрывать попытку рано — дожидаемся, чем закончится повтор.
      lastError = state.error;
      options.logger?.(`виджет сообщил об ошибке ${state.error}, ждём повтора`);
    }

    if (Date.now() >= nextClickAt && (await clickCheckbox(page))) {
      options.logger?.('клик по чекбоксу');
      nextClickAt = Date.now() + CLICK_INTERVAL;
    }

    await sleep(POLL_INTERVAL);
  }

  throw new TurnstileError(
    TurnstileFailure.Timeout,
    `Виджет Turnstile не отдал токен за ${options.timeout} мс` +
      (lastError ? `; последняя ошибка виджета — ${lastError}` : ''),
    lastError ? { widgetCode: lastError } : {},
  );
}

async function solveOnce(browser: Browser, options: ResolvedOptions): Promise<string> {
  // Каждая попытка идёт в чистом контексте: cookie и хранилище от неудачной попытки
  // достались бы следующей, а виджет их учитывает.
  const context = await browser.newContext({
    locale: 'ru-RU',
    viewport: { width: 1280, height: 800 },
  });

  try {
    const page = await context.newPage();
    const url = `${options.origin}/`;
    const body = buildWidgetPage(options.sitekey, options.theme);

    // На сайт запроса не уходит: навигация перехватывается и подменяется своей страницей.
    // Origin для браузера при этом настоящий, поэтому виджет проходит проверку домена,
    // а сервер при siteverify видит ожидаемый hostname.
    await page.route(url, (route) =>
      route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body }),
    );
    await page.goto(url, { waitUntil: 'domcontentloaded' });

    return await waitForToken(page, options);
  } finally {
    await context.close().catch(() => {});
  }
}

/** Ошибки настройки: повтор их не исправит. */
function isPermanent(error: unknown): boolean {
  if (!(error instanceof TurnstileError)) return false;
  if (error.reason === TurnstileFailure.DriverMissing) return true;
  if (error.reason === TurnstileFailure.LaunchFailed) return true;

  return error.widgetCode?.startsWith(DOMAIN_ERROR_PREFIX) ?? false;
}

/**
 * Получает один токен Turnstile.
 *
 * Поднимает браузер, берёт токен и закрывает браузер за собой. Для клиента `itd-api`
 * удобнее {@link createTurnstileSolver}: он отдаёт функцию нужной формы.
 *
 * @throws {TurnstileError} если токен получить не удалось
 * @throws {TypeError} при некорректных настройках
 */
export async function solveTurnstile(options: TurnstileOptions = {}): Promise<string> {
  const resolved = resolveOptions(options);
  const browser = resolved.browser ?? (await launchBrowser(resolved));
  const owned = resolved.browser === undefined;

  try {
    for (let attempt = 1; attempt <= resolved.attempts; attempt++) {
      try {
        resolved.logger?.(`попытка ${attempt} из ${resolved.attempts}`);
        return await solveOnce(browser, resolved);
      } catch (error) {
        if (isPermanent(error) || attempt === resolved.attempts) throw error;
        resolved.logger?.(
          `попытка ${attempt} не удалась: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    // Недостижимо: последняя попытка либо возвращает токен, либо бросает ошибку.
    throw new TurnstileError(TurnstileFailure.Timeout, 'Токен Turnstile получить не удалось');
  } finally {
    if (owned) await browser.close().catch(() => {});
  }
}

/**
 * Собирает функцию для `auth.getTurnstileToken` клиента `itd-api`.
 *
 * Возвращается функция, а не готовый токен: токен одноразовый и живёт несколько минут,
 * поэтому клиент спрашивает его заново перед каждым входом. Браузер поднимается на время
 * одного вызова и сразу закрывается.
 *
 * @example
 * ```ts
 * import { ItdClient, FileTokenStorage } from 'itd-api/node';
 * import { createTurnstileSolver } from 'itd-api-turnstile';
 *
 * const itd = new ItdClient({
 *   storage: new FileTokenStorage('./.itd-session.json'),
 *   auth: { email, password, getTurnstileToken: createTurnstileSolver() },
 * });
 * ```
 */
export function createTurnstileSolver(options: TurnstileOptions = {}): () => Promise<string> {
  return () => solveTurnstile(options);
}
