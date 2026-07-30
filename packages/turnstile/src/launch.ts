import { TurnstileError, TurnstileFailure } from './errors.js';
import type { Browser, LaunchOptions, PlaywrightModule } from './playwright.js';

/**
 * Аргументы запуска Chromium.
 *
 * Подмены `User-Agent` здесь нет намеренно: заявленная версия браузера расходилась бы
 * с реальным движком, а такое расхождение само по себе служит признаком автоматизации.
 * Остаются безопасные общие флаги. Отключение sandbox вынесено в явную настройку:
 * удалённый код виджета исполняется в браузере, и ослаблять его изоляцию по умолчанию нельзя.
 */
const DEFAULT_ARGS = ['--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled'];

/** Драйверы в порядке предпочтения. */
const DRIVERS = ['playwright', 'playwright-core'];

function isModuleNotFound(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND';
}

/**
 * Подключает драйвер браузера.
 *
 * Импорт динамический: драйвер объявлен необязательной одноранговой зависимостью,
 * поэтому его может не быть вовсе.
 */
async function loadPlaywright(): Promise<PlaywrightModule> {
  for (const name of DRIVERS) {
    try {
      return (await import(/* @vite-ignore */ name)) as PlaywrightModule;
    } catch (error) {
      // Установленный драйвер, упавший при загрузке, — не то же самое, что отсутствующий.
      // Его ошибку нужно показать как есть, а не подменять советом установить пакет.
      if (!isModuleNotFound(error)) throw error;
    }
  }

  throw new TurnstileError(
    TurnstileFailure.DriverMissing,
    'Не найден драйвер браузера. Установите его командой: npm i playwright && npx playwright install chromium. ' +
      'Либо передайте свой запуск браузера через параметр launch.',
  );
}

/** Настройки запуска браузера. */
export interface BrowserOptions {
  /**
   * Запускать ли браузер без окна. По умолчанию `false`.
   *
   * В безоконном режиме виджет проходится заметно хуже: признаки такого режима видны
   * странице. На сервере поднимите виртуальный дисплей (`xvfb-run -a node bot.js`).
   */
  headless?: boolean | undefined;
  /** Путь к исполняемому файлу браузера, если он лежит не там, где ищет Playwright. */
  executablePath?: string | undefined;
  /** Дополнительные аргументы командной строки — добавляются к стандартным. */
  args?: readonly string[] | undefined;
  /**
   * Отключить sandbox Chromium. По умолчанию `false`.
   *
   * Используйте только внутри изолированного контейнера, где sandbox невозможно настроить:
   * страница исполняет удалённый код виджета, и без изоляции браузера его компрометация
   * получает больше доступа к процессу и системе.
   */
  disableSandbox?: boolean | undefined;
  /** Прокси для браузера. */
  proxy?: { server: string; username?: string; password?: string } | undefined;
  /**
   * Свой запуск браузера. Заменяет все остальные параметры запуска.
   *
   * Нужен, чтобы подставить другой драйвер или подключиться к уже работающему браузеру.
   *
   * @example
   * ```ts
   * launch: async () => {
   *   const { chromium } = await import('patchright');
   *   return chromium.launch({ headless: false });
   * };
   * ```
   */
  launch?: (() => Promise<Browser>) | undefined;
}

/** Собирает параметры Playwright без запуска браузера. @internal */
export function resolveLaunchOptions(options: BrowserOptions): LaunchOptions {
  return {
    headless: options.headless ?? false,
    args: [
      ...DEFAULT_ARGS,
      ...(options.disableSandbox ? ['--no-sandbox'] : []),
      ...(options.args ?? []),
    ],
    ...(options.executablePath ? { executablePath: options.executablePath } : {}),
    ...(options.proxy ? { proxy: options.proxy } : {}),
  };
}

/** Поднимает браузер по настройкам. */
export async function launchBrowser(options: BrowserOptions): Promise<Browser> {
  if (options.launch) return options.launch();

  const { chromium } = await loadPlaywright();
  const launchOptions = resolveLaunchOptions(options);

  try {
    return await chromium.launch(launchOptions);
  } catch (error) {
    const hint =
      launchOptions.headless === false
        ? ' Если это сервер без графической оболочки, запустите процесс через xvfb-run -a.'
        : '';

    throw new TurnstileError(
      TurnstileFailure.LaunchFailed,
      `Не удалось запустить браузер: ${error instanceof Error ? error.message : String(error)}.${hint}`,
    );
  }
}
