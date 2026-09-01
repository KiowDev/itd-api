import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  BoundingBox,
  Browser,
  BrowserContext,
  ElementHandle,
  Mouse,
  NewContextOptions,
  Page,
  Route,
} from '../src/driver.js';
import { CaptchaError, CaptchaFailure } from '../src/errors.js';
import type { CaptchaHandler } from '../src/handler.js';
import { launchBrowser, resolveLaunchOptions } from '../src/launch.js';
import { ITD_CAPTCHA_SITE_KEY } from '../src/providers/itd.js';
import { TURNSTILE_SITE_KEY, turnstile } from '../src/providers/turnstile.js';
import { createCaptchaSolver, solveCaptcha } from '../src/solve.js';
import { CaptchaType } from '../src/types.js';

/** Поддельный браузер: весь путь до токена проверяется без драйвера и без сети. */

const BOX: BoundingBox = { x: 40, y: 40, width: 300, height: 74 };

async function withVirtualTime<T>(operation: () => Promise<T>): Promise<T> {
  vi.useFakeTimers();
  const result = operation().then(
    (value) => ({ status: 'fulfilled' as const, value }),
    (reason: unknown) => ({ status: 'rejected' as const, reason }),
  );
  await vi.runAllTimersAsync();
  const settled = await result;
  if (settled.status === 'rejected') throw settled.reason;
  return settled.value;
}

afterEach(() => vi.useRealTimers());

describe('настройки запуска браузера', () => {
  it('не отключает sandbox по умолчанию', () => {
    expect(resolveLaunchOptions({}).args).not.toContain('--no-sandbox');
  });

  it('отключает sandbox только по явной opt-in настройке', () => {
    expect(resolveLaunchOptions({ disableSandbox: true }).args).toContain('--no-sandbox');
  });

  it('подмешивает свои флаги обычному драйверу', () => {
    expect(resolveLaunchOptions({}, 'playwright').args).toContain(
      '--disable-blink-features=AutomationControlled',
    );
  });

  it('не принимает под видом драйвера путь', async () => {
    // Имя уезжает в динамический импорт, поэтому относительным адресом быть не должно.
    await expect(launchBrowser({ driver: '../evil' })).rejects.toThrow(TypeError);
    await expect(launchBrowser({ driver: './evil.js' })).rejects.toThrow(TypeError);
  });

  it('не подставляет соседний драйвер вместо названного', async () => {
    const error = await launchBrowser({ driver: 'playwright-no-such-package' }).catch(
      (e: unknown) => e,
    );

    expect((error as CaptchaError).reason).toBe(CaptchaFailure.DriverMissing);
    expect((error as CaptchaError).message).toContain('playwright-no-such-package');
  });

  it('не трогает флаги драйвера, который выверил их сам', () => {
    const args = resolveLaunchOptions(
      { disableSandbox: true, args: ['--mute-audio'] },
      'patchright',
    ).args;

    expect(args).not.toContain('--disable-blink-features=AutomationControlled');
    expect(args).not.toContain('--disable-dev-shm-usage');
    expect(args).toContain('--no-sandbox');
    expect(args).toContain('--mute-audio');
  });
});

class FakeRoute implements Route {
  body: string | undefined;

  async fulfill(options: { status?: number; contentType?: string; body?: string }): Promise<void> {
    this.body = options.body;
  }
}

interface FakePageOptions {
  /** После какого по счёту клика виджет отдаёт токен. `0` — проходится сам. */
  tokenAfterClicks?: number;
  /** Отдать токен через скрытое поле Turnstile, не вызывая callback. */
  viaInput?: boolean;
  /** Не отрисовывать обёртку виджета. */
  noWidget?: boolean;
  /** Код ошибки, о котором виджет сообщит сразу после загрузки. */
  error?: string;
  /** Страница закрыта: драйвер отвечает ошибкой на любое обращение к ней. */
  closed?: boolean;
}

class FakePage implements Page {
  readonly clicks: Array<{ x: number; y: number }> = [];
  navigatedTo: string | undefined;
  servedBody: string | undefined;

  readonly #handlers = new Map<string, (route: Route) => void | Promise<void>>();
  readonly #options: FakePageOptions;

  readonly #scope: {
    __itdToken: string | null;
    __itdError: string | null;
  } = { __itdToken: null, __itdError: null };
  readonly #field = { value: '' };

  constructor(options: FakePageOptions = {}) {
    this.#options = options;
  }

  async route(url: string, handler: (route: Route) => void | Promise<void>): Promise<void> {
    this.#handlers.set(url, handler);
  }

  async goto(url: string): Promise<unknown> {
    const handler = this.#handlers.get(url);
    if (!handler) throw new Error(`навигация на ${url} не перехвачена`);

    const route = new FakeRoute();
    await handler(route);

    this.navigatedTo = url;
    this.servedBody = route.body;

    if (this.#options.error) this.#scope.__itdError = this.#options.error;
    if ((this.#options.tokenAfterClicks ?? 1) === 0) this.#solved();

    return null;
  }

  async waitForSelector(): Promise<unknown> {
    if (this.#options.noWidget) throw new Error('элемент не появился');
    return null;
  }

  evaluate<R>(fn: () => R): Promise<R> {
    if (this.#options.closed) {
      throw new Error('page.evaluate: Target page, context or browser has been closed');
    }

    const globals = globalThis as unknown as Record<string, unknown>;
    const previousWindow = globals.window;
    const previousDocument = globals.document;

    globals.window = this.#scope;
    globals.document = { querySelector: () => this.#field };

    try {
      return Promise.resolve(fn());
    } finally {
      globals.window = previousWindow;
      globals.document = previousDocument;
    }
  }

  async $(): Promise<ElementHandle | null> {
    return { boundingBox: async () => BOX };
  }

  readonly mouse: Mouse = {
    move: async () => {},
    click: async (x: number, y: number) => {
      this.clicks.push({ x, y });
      if (this.clicks.length >= (this.#options.tokenAfterClicks ?? 1)) this.#solved();
    },
  };

  async close(): Promise<void> {}

  #solved(): void {
    // Токен всегда попадает в DOM-поле — из него читают оба провайдера. Turnstile вдобавок
    // умеет читать window-переменную (её ставит его callback), кроме случая viaInput, где
    // проверяется чтение именно из поля.
    this.#field.value = 'TOKEN';
    if (!this.#options.viaInput) this.#scope.__itdToken = 'TOKEN';
  }
}

class FakeBrowser implements Browser {
  contexts = 0;
  closed = false;
  contextOptions: NewContextOptions | undefined;

  readonly #page: FakePage;

  constructor(page: FakePage) {
    this.#page = page;
  }

  async newContext(options?: NewContextOptions): Promise<BrowserContext> {
    this.contexts += 1;
    this.contextOptions = options;
    return {
      newPage: async () => this.#page,
      close: async () => {},
    };
  }

  version(): string {
    return '149.0.7827.55';
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

describe('решение Turnstile', () => {
  it('отдаёт свою страницу по адресу сайта и возвращает токен', async () => {
    const page = new FakePage({ tokenAfterClicks: 1 });

    const token = await withVirtualTime(() =>
      solveCaptcha(CaptchaType.Cloudflare, { browser: new FakeBrowser(page) }),
    );

    expect(token).toBe('TOKEN');
    expect(page.navigatedTo).toBe('https://xn--d1ah4a.com/');
    expect(page.servedBody).toContain(TURNSTILE_SITE_KEY);
  });

  it('целится в чекбокс от своего контейнера', async () => {
    const page = new FakePage({ tokenAfterClicks: 1 });

    await withVirtualTime(() =>
      solveCaptcha(CaptchaType.Cloudflare, { browser: new FakeBrowser(page) }),
    );

    const click = page.clicks[0];
    expect(click?.x).toBeGreaterThan(BOX.x + 20);
    expect(click?.x).toBeLessThan(BOX.x + 40);
    expect(click?.y).toBeGreaterThan(BOX.y + BOX.height / 2 - 10);
    expect(click?.y).toBeLessThan(BOX.y + BOX.height / 2 + 10);
  });

  it('берёт токен из скрытого поля, когда виджет прошёлся сам', async () => {
    const page = new FakePage({ tokenAfterClicks: 0, viaInput: true, noWidget: true });

    const token = await solveCaptcha(CaptchaType.Cloudflare, { browser: new FakeBrowser(page) });

    expect(token).toBe('TOKEN');
    expect(page.clicks).toHaveLength(0);
  });

  it('сообщает код ошибки виджета и не повторяет попытку при 110200', async () => {
    const browser = new FakeBrowser(new FakePage({ error: '110200' }));

    const error = await solveCaptcha(CaptchaType.Cloudflare, { browser, attempts: 3 }).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(CaptchaError);
    expect((error as CaptchaError).reason).toBe(CaptchaFailure.WidgetError);
    expect((error as CaptchaError).type).toBe(CaptchaType.Cloudflare);
    expect((error as CaptchaError).widgetCode).toBe('110200');
    expect(browser.contexts).toBe(1);
  });

  it('переживает временную ошибку виджета: он повторяет попытку сам', async () => {
    const page = new FakePage({ error: '300010', tokenAfterClicks: 1 });

    await expect(
      withVirtualTime(() =>
        solveCaptcha(CaptchaType.Cloudflare, { browser: new FakeBrowser(page) }),
      ),
    ).resolves.toBe('TOKEN');
  });

  it('сдаётся по таймауту и объясняет последнюю ошибку', async () => {
    const browser = new FakeBrowser(new FakePage({ error: '300010', tokenAfterClicks: 1000 }));

    const error = await withVirtualTime(() =>
      solveCaptcha(CaptchaType.Cloudflare, { browser, timeout: 3000, attempts: 1 }),
    ).catch((e: unknown) => e);

    expect((error as CaptchaError).reason).toBe(CaptchaFailure.Timeout);
    expect((error as CaptchaError).widgetCode).toBe('300010');
    expect((error as CaptchaError).message).toContain('149.0.7827.55');
  });
});

describe('решение капчи ИТД', () => {
  it('встраивает виджет ИТД с его ключом и возвращает токен', async () => {
    const page = new FakePage({ tokenAfterClicks: 1 });

    const token = await withVirtualTime(() =>
      solveCaptcha(CaptchaType.Itd, { browser: new FakeBrowser(page) }),
    );

    expect(token).toBe('TOKEN');
    expect(page.navigatedTo).toBe('https://xn--d1ah4a.com/');
    expect(page.servedBody).toContain(ITD_CAPTCHA_SITE_KEY);
    expect(page.servedBody).toContain('https://captcha.xn--d1ah4a.com/widget.html');
  });

  it('не закрывает чужой браузер', async () => {
    const browser = new FakeBrowser(new FakePage({ tokenAfterClicks: 0 }));

    await solveCaptcha(CaptchaType.Itd, { browser });

    expect(browser.closed).toBe(false);
  });
});

describe('выбор провайдера', () => {
  it('принимает имя, которым провайдера называет сервер', async () => {
    const page = new FakePage({ tokenAfterClicks: 0 });

    await solveCaptcha('cloudflare', { browser: new FakeBrowser(page) });

    expect(page.servedBody).toContain(TURNSTILE_SITE_KEY);
  });

  it('принимает turnstile как синоним cloudflare', async () => {
    const page = new FakePage({ tokenAfterClicks: 0 });

    await solveCaptcha('turnstile', { browser: new FakeBrowser(page) });

    expect(page.servedBody).toContain(TURNSTILE_SITE_KEY);
  });

  it('останавливается на незнакомом имени и перечисляет известные', async () => {
    const error = await solveCaptcha('hcaptcha', {
      browser: new FakeBrowser(new FakePage()),
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(TypeError);
    expect((error as TypeError).message).toContain('hcaptcha');
    expect((error as TypeError).message).toContain('itd');
  });

  it('решает свой обработчик тем же путём, что и встроенные', async () => {
    // Точка расширения: новому провайдеру достаточно реализовать CaptchaHandler.
    const custom: CaptchaHandler = {
      type: 'my-captcha',
      label: 'моей капчи',
      buildPage: ({ theme }) => `<!doctype html><html data-theme="${theme}"><body></body></html>`,
      widgetReadySelector: '#widget',
      checkboxOffsetX: 12,
      readState: (page) =>
        page.evaluate(() => {
          const field = document.querySelector('#my-token') as { value?: string } | null;
          return { token: field?.value || null, error: null };
        }),
      isPermanentWidgetError: () => false,
    };
    const page = new FakePage({ tokenAfterClicks: 1 });

    const token = await withVirtualTime(() =>
      solveCaptcha(custom, { browser: new FakeBrowser(page) }),
    );

    expect(token).toBe('TOKEN');
    expect(page.servedBody).toContain('data-theme="auto"');
  });

  it('не ходит в сеть: провайдера выбирает вызывающий', async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error('пакет не должен делать запросов')));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    try {
      await solveCaptcha(CaptchaType.Itd, {
        browser: new FakeBrowser(new FakePage({ tokenAfterClicks: 0 })),
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('закрытый браузер', () => {
  it('называет причину и не тратит на неё повторы', async () => {
    const browser = new FakeBrowser(new FakePage({ closed: true }));

    const error = await solveCaptcha(CaptchaType.Itd, { browser, attempts: 3 }).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(CaptchaError);
    expect((error as CaptchaError).reason).toBe(CaptchaFailure.BrowserClosed);
    expect((error as CaptchaError).type).toBe(CaptchaType.Itd);
    expect(browser.contexts).toBe(1);
  });
});

describe('контекст браузера', () => {
  it('задаёт контексту язык и размер окна', async () => {
    const browser = new FakeBrowser(new FakePage({ tokenAfterClicks: 0 }));

    await solveCaptcha(CaptchaType.Cloudflare, { browser });

    expect(browser.contextOptions?.locale).toBe('ru-RU');
    expect(browser.contextOptions?.viewport).toEqual({ width: 1280, height: 800 });
  });

  it('отдаёт контекст целиком на откуп contextOptions', async () => {
    const browser = new FakeBrowser(new FakePage({ tokenAfterClicks: 0 }));

    await solveCaptcha(CaptchaType.Cloudflare, { browser, contextOptions: {} });

    expect(browser.contextOptions).toEqual({});
  });
});

describe('проверка настроек', () => {
  it('отклоняет некорректные значения до запуска браузера', async () => {
    const type = CaptchaType.Cloudflare;

    await expect(solveCaptcha(type, { origin: 'не-адрес' })).rejects.toThrow(TypeError);
    await expect(solveCaptcha(type, { origin: 'ftp://example.com' })).rejects.toThrow(TypeError);
    await expect(solveCaptcha(type, { origin: 'https://user:pass@example.com' })).rejects.toThrow(
      TypeError,
    );
    await expect(solveCaptcha(type, { attempts: 0 })).rejects.toThrow(TypeError);
    await expect(solveCaptcha(type, { timeout: 0 })).rejects.toThrow(TypeError);
    await expect(solveCaptcha(type, { theme: 'blue' as never })).rejects.toThrow(TypeError);
    await expect(solveCaptcha(type, { disableSandbox: 'yes' as never })).rejects.toThrow(TypeError);
    await expect(solveCaptcha(type, { logger: true as never })).rejects.toThrow(TypeError);
    await expect(solveCaptcha(type, { args: ['ok', 42] as never })).rejects.toThrow(TypeError);
    await expect(solveCaptcha(type, { contextOptions: 'ru' as never })).rejects.toThrow(TypeError);
    await expect(solveCaptcha(type, { driver: '' })).rejects.toThrow(TypeError);
    await expect(solveCaptcha(type, { channel: 42 as never })).rejects.toThrow(TypeError);
  });
});

describe('createCaptchaSolver', () => {
  it('решает тот тип, который назвал клиент', async () => {
    const page = new FakePage({ tokenAfterClicks: 0 });
    const solver = createCaptchaSolver({ browser: new FakeBrowser(page) });

    const token = await solver.getToken(CaptchaType.Itd);

    expect(token).toBe('TOKEN');
    expect(solver.type).toBeUndefined();
    expect(page.servedBody).toContain(ITD_CAPTCHA_SITE_KEY);
  });

  it('закреплённый тип решается всегда, что бы ни попросил клиент', async () => {
    const page = new FakePage({ tokenAfterClicks: 0 });
    const solver = createCaptchaSolver({
      type: CaptchaType.Cloudflare,
      browser: new FakeBrowser(page),
    });

    await solver.getToken(CaptchaType.Itd);

    // Закреплённый тип клиент читает заранее и запрашивает именно его; аргумент здесь лишний.
    expect(solver.type).toBe(CaptchaType.Cloudflare);
    expect(page.servedBody).toContain(TURNSTILE_SITE_KEY);
  });

  it('принимает готового провайдера с его настройками', async () => {
    const page = new FakePage({ tokenAfterClicks: 0 });
    const solver = createCaptchaSolver({
      type: turnstile({ sitekey: '0xOWN' }),
      browser: new FakeBrowser(page),
    });

    await solver.getToken(CaptchaType.Cloudflare);

    expect(solver.type).toBe(CaptchaType.Cloudflare);
    expect(page.servedBody).toContain('0xOWN');
  });

  it('передаёт клиенту имя поля для закреплённого типа', () => {
    const solver = createCaptchaSolver({ type: CaptchaType.Cloudflare, field: 'c7f2' });

    expect(solver.field).toBe('c7f2');
  });

  it('отвергает незнакомый тип и поле без типа сразу при создании', () => {
    expect(() => createCaptchaSolver({ type: 'hcaptcha' })).toThrow(TypeError);
  });
});
