import { describe, expect, it } from 'vitest';
import { TurnstileError, TurnstileFailure } from '../src/errors.js';
import type {
  BoundingBox,
  Browser,
  BrowserContext,
  ElementHandle,
  Mouse,
  Page,
  Route,
} from '../src/playwright.js';
import { ITD_SITE_KEY, solveTurnstile } from '../src/solve.js';

/** Поддельный браузер: весь путь до токена проверяется без Playwright и без сети. */

const BOX: BoundingBox = { x: 40, y: 40, width: 300, height: 65 };

class FakeRoute implements Route {
  body: string | undefined;

  async fulfill(options: { status?: number; contentType?: string; body?: string }): Promise<void> {
    this.body = options.body;
  }
}

interface FakePageOptions {
  /** После какого по счёту клика виджет отдаст токен. `0` — проходится сам. */
  tokenAfterClicks?: number;
  /**
   * Отдать токен только через скрытое поле, не вызывая `callback`.
   *
   * Так ведёт себя виджет, прошедшийся без участия человека.
   */
  viaInput?: boolean;
  /** Не отрисовывать обёртку виджета. */
  noWidget?: boolean;
  /** Код ошибки, о котором виджет сообщит сразу после загрузки. */
  error?: string;
}

class FakePage implements Page {
  readonly clicks: Array<{ x: number; y: number }> = [];
  navigatedTo: string | undefined;
  servedBody: string | undefined;

  readonly #handlers = new Map<string, (route: Route) => void | Promise<void>>();
  readonly #options: FakePageOptions;

  /** То, что видит код на странице: `window` и скрытое поле виджета. */
  readonly #scope: { __itdToken: string | null; __itdError: string | null } = {
    __itdToken: null,
    __itdError: null,
  };
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

  /** Выполняет функцию с подставленными `window` и `document` — как это сделал бы браузер. */
  evaluate<R>(fn: () => R): Promise<R> {
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
    if (this.#options.viaInput) this.#field.value = 'TOKEN';
    else this.#scope.__itdToken = 'TOKEN';
  }
}

class FakeBrowser implements Browser {
  contexts = 0;
  closed = false;

  readonly #page: FakePage;

  constructor(page: FakePage) {
    this.#page = page;
  }

  async newContext(): Promise<BrowserContext> {
    this.contexts += 1;
    return {
      newPage: async () => this.#page,
      close: async () => {},
    };
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

describe('solveTurnstile', () => {
  it('отдаёт свою страницу по адресу сайта и возвращает токен', async () => {
    const page = new FakePage({ tokenAfterClicks: 1 });
    const browser = new FakeBrowser(page);

    const token = await solveTurnstile({ browser });

    expect(token).toBe('TOKEN');
    // Origin должен остаться настоящим, иначе виджет откажет по несовпадению домена.
    expect(page.navigatedTo).toBe('https://xn--d1ah4a.com/');
    expect(page.servedBody).toContain(ITD_SITE_KEY);
  });

  it('целится в чекбокс от своего контейнера', async () => {
    const page = new FakePage({ tokenAfterClicks: 1 });

    await solveTurnstile({ browser: new FakeBrowser(page) });

    const click = page.clicks[0];
    expect(click).toBeDefined();
    // Чекбокс — примерно в 30 px от левого края и по вертикали посередине.
    expect(click?.x).toBeGreaterThan(BOX.x + 20);
    expect(click?.x).toBeLessThan(BOX.x + 40);
    expect(click?.y).toBeGreaterThan(BOX.y + BOX.height / 2 - 10);
    expect(click?.y).toBeLessThan(BOX.y + BOX.height / 2 + 10);
  });

  it('не закрывает чужой браузер', async () => {
    const browser = new FakeBrowser(new FakePage({ tokenAfterClicks: 0 }));

    await solveTurnstile({ browser });

    expect(browser.closed).toBe(false);
  });

  it('берёт токен из скрытого поля, когда виджет прошёлся сам', async () => {
    // callback не позвали, обёртки виджета в разметке нет, токен лежит
    // в cf-turnstile-response.
    const page = new FakePage({ tokenAfterClicks: 0, viaInput: true, noWidget: true });

    const token = await solveTurnstile({ browser: new FakeBrowser(page) });

    expect(token).toBe('TOKEN');
    // Готовый виджет трогать незачем.
    expect(page.clicks).toHaveLength(0);
  });

  it('не считает отсутствие ожидаемой разметки поводом сдаться', async () => {
    const page = new FakePage({ noWidget: true, tokenAfterClicks: 1 });

    await expect(solveTurnstile({ browser: new FakeBrowser(page) })).resolves.toBe('TOKEN');
  });

  it('сообщает код ошибки виджета и не повторяет попытку при 110200', async () => {
    const browser = new FakeBrowser(new FakePage({ error: '110200' }));

    const error = await solveTurnstile({ browser, attempts: 3 }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(TurnstileError);
    expect((error as TurnstileError).reason).toBe(TurnstileFailure.WidgetError);
    expect((error as TurnstileError).widgetCode).toBe('110200');
    expect((error as TurnstileError).message).toContain('не разрешён для домена');
    // Ключ не станет разрешённым со второй попытки.
    expect(browser.contexts).toBe(1);
  });

  it('переживает временную ошибку виджета: он повторяет попытку сам', async () => {
    // Коды кроме 110*** временные, и error-callback просит виджет попробовать снова.
    const page = new FakePage({ error: '300010', tokenAfterClicks: 1 });

    await expect(solveTurnstile({ browser: new FakeBrowser(page) })).resolves.toBe('TOKEN');
  });

  it('сдаётся по таймауту', async () => {
    // Токена не будет никогда: порог кликов недостижим за отведённое время.
    const browser = new FakeBrowser(new FakePage({ tokenAfterClicks: 1000 }));

    const error = await solveTurnstile({ browser, timeout: 3000, attempts: 1 }).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(TurnstileError);
    expect((error as TurnstileError).reason).toBe(TurnstileFailure.Timeout);
  });

  it('прикладывает к таймауту последнюю ошибку виджета', async () => {
    const browser = new FakeBrowser(new FakePage({ error: '300010', tokenAfterClicks: 1000 }));

    const error = await solveTurnstile({ browser, timeout: 3000, attempts: 1 }).catch(
      (e: unknown) => e,
    );

    expect((error as TurnstileError).reason).toBe(TurnstileFailure.Timeout);
    expect((error as TurnstileError).widgetCode).toBe('300010');
  });

  it('проверяет настройки до запуска браузера', async () => {
    await expect(solveTurnstile({ origin: 'не-адрес' })).rejects.toThrow(TypeError);
    await expect(solveTurnstile({ origin: 'ftp://example.com' })).rejects.toThrow(TypeError);
    await expect(solveTurnstile({ attempts: 0 })).rejects.toThrow(TypeError);
    await expect(solveTurnstile({ timeout: 0 })).rejects.toThrow(TypeError);
  });
});
