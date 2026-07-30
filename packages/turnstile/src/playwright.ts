/**
 * Минимальные структурные типы драйвера браузера.
 *
 * Playwright не импортируется даже как тип: пакет собирается и проверяется без него,
 * а на его место годится любой совместимый по API драйвер — `playwright-core`, `patchright`,
 * `rebrowser-playwright`. Описаны только те методы, которыми пользуется солвер.
 */

/** Перехваченный запрос. Нужен, чтобы отдать свою страницу вместо настоящей. */
export interface Route {
  fulfill(options: { status?: number; contentType?: string; body?: string }): Promise<void>;
}

/** Прямоугольник элемента в координатах страницы. */
export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ElementHandle {
  boundingBox(): Promise<BoundingBox | null>;
}

/** Мышь уровня страницы: события идут через CDP, а не через DOM. */
export interface Mouse {
  move(x: number, y: number, options?: { steps?: number }): Promise<void>;
  click(x: number, y: number, options?: { delay?: number }): Promise<void>;
}

export interface Page {
  route(url: string, handler: (route: Route) => void | Promise<void>): Promise<void>;
  goto(url: string, options?: { waitUntil?: 'domcontentloaded' | 'load' }): Promise<unknown>;
  evaluate<R>(fn: () => R): Promise<R>;
  waitForSelector(
    selector: string,
    options?: { timeout?: number; state?: 'attached' | 'visible' },
  ): Promise<unknown>;
  $(selector: string): Promise<ElementHandle | null>;
  readonly mouse: Mouse;
  close(): Promise<void>;
}

export interface BrowserContext {
  newPage(): Promise<Page>;
  close(): Promise<void>;
}

/** Настройки контекста. Совпадают по форме с `browser.newContext` в Playwright. */
export interface NewContextOptions {
  locale?: string;
  viewport?: { width: number; height: number };
}

export interface Browser {
  newContext(options?: NewContextOptions): Promise<BrowserContext>;
  close(): Promise<void>;
}

/** Настройки запуска. Совпадают по форме с `chromium.launch` в Playwright. */
export interface LaunchOptions {
  headless?: boolean;
  executablePath?: string;
  args?: string[];
  proxy?: { server: string; username?: string; password?: string };
}

export interface BrowserType {
  launch(options?: LaunchOptions): Promise<Browser>;
}

/** То, что отдаёт `import('playwright')`. */
export interface PlaywrightModule {
  chromium: BrowserType;
  firefox?: BrowserType;
}
