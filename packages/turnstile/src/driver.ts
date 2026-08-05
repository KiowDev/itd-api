/**
 * Минимальные структурные типы драйвера браузера.
 *
 * Ни один драйвер не импортируется даже как тип: пакет собирается и проверяется без них,
 * а подойдёт любой совместимый по API — `patchright`, `playwright`, `playwright-core`,
 * Camoufox. Форма взята у Playwright, потому что её повторяют остальные. Описаны только
 * те методы, которыми пользуется солвер.
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

/**
 * Настройки контекста. Совпадают по форме с `browser.newContext` в Playwright.
 *
 * Кроме перечисленных полей принимается что угодно ещё: драйверы вроде Camoufox понимают
 * свои настройки, и перечислять их здесь пакет не берётся.
 */
export interface NewContextOptions {
  locale?: string;
  viewport?: { width: number; height: number } | null;
  userAgent?: string;
  [option: string]: unknown;
}

export interface Browser {
  newContext(options?: NewContextOptions): Promise<BrowserContext>;
  /** Версия браузера, например `149.0.7827.55`. Есть не у всякого драйвера. */
  version?(): string;
  close(): Promise<void>;
}

/** Настройки запуска. Совпадают по форме с `chromium.launch` в Playwright. */
export interface LaunchOptions {
  headless?: boolean;
  executablePath?: string;
  channel?: string;
  args?: string[];
  proxy?: { server: string; username?: string; password?: string };
}

export interface BrowserType {
  launch(options?: LaunchOptions): Promise<Browser>;
}

/** То, что отдаёт `import('patchright')`, `import('playwright')` и им подобные. */
export interface DriverModule {
  chromium: BrowserType;
}
