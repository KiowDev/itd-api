import type { Browser, DriverModule, LaunchOptions } from './driver.js';
import { TurnstileError, TurnstileFailure } from './errors.js';

/**
 * Аргументы запуска Chromium.
 *
 * Подмены `User-Agent` здесь нет намеренно: заявленная версия браузера расходилась бы
 * с реальным движком, а такое расхождение само по себе служит признаком автоматизации.
 * Остаются безопасные общие флаги. Отключение sandbox вынесено в явную настройку:
 * удалённый код виджета исполняется в браузере, и ослаблять его изоляцию по умолчанию нельзя.
 */
const DEFAULT_ARGS = ['--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled'];

/**
 * Драйверы в порядке предпочтения.
 *
 * `patchright` впереди намеренно: он ставит собственную сборку Chromium, и та проходит
 * виджет там, где сборка из свежего Playwright уже нет. Если стоит только `playwright`,
 * ничего не меняется — берётся он.
 */
const DRIVERS = ['patchright', 'playwright', 'playwright-core'];

/**
 * Как выглядит имя пакета драйвера.
 *
 * Имя приходит извне и уезжает в динамический импорт, поэтому путями и относительными
 * адресами быть не должно — только имя пакета.
 */
const DRIVER_NAME = /^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/i;

/**
 * Драйверы, которые сами приводят аргументы запуска в порядок.
 *
 * Им ничего не подмешивается: набор флагов у них выверен, а лишний флаг — такой же след,
 * как и недостающий.
 */
const SELF_TUNED_DRIVERS = new Set(['patchright']);

function isModuleNotFound(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND';
}

/**
 * Подключает драйвер браузера.
 *
 * Импорт динамический: драйвер объявлен необязательной одноранговой зависимостью,
 * поэтому его может не быть вовсе. Названный явно берётся один, без перебора: молча
 * подставить вместо него другой значило бы проверить не то, что просили.
 */
async function loadDriver(requested?: string): Promise<{ driver: string; module: DriverModule }> {
  const wanted = requested ? [requested] : DRIVERS;

  for (const name of wanted) {
    try {
      return { driver: name, module: (await import(/* @vite-ignore */ name)) as DriverModule };
    } catch (error) {
      // Установленный драйвер, упавший при загрузке, — не то же самое, что отсутствующий.
      // Его ошибку нужно показать как есть, а не подменять советом установить пакет.
      if (!isModuleNotFound(error)) throw error;
    }
  }

  throw new TurnstileError(
    TurnstileFailure.DriverMissing,
    requested
      ? `Драйвер ${requested} не установлен.`
      : 'Не найден драйвер браузера. Установите его командой: npm i patchright && npx patchright install chromium. ' +
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
  /**
   * Какой драйвер брать вместо перебора `patchright` → `playwright` → `playwright-core`.
   *
   * Нужен, когда установлено несколько и важно, какой именно поднимется. Названный
   * драйвер берётся один: не найден — ошибка, а не молчаливая подмена соседним.
   */
  driver?: string | undefined;
  /** Путь к исполняемому файлу браузера, если он лежит не там, где его ищет драйвер. */
  executablePath?: string | undefined;
  /** Канал браузера, например `chrome` или `msedge`, — вместо сборки из комплекта драйвера. */
  channel?: string | undefined;
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

/** Собирает параметры запуска, не поднимая браузер. @internal */
export function resolveLaunchOptions(options: BrowserOptions, driver = ''): LaunchOptions {
  return {
    headless: options.headless ?? false,
    args: [
      ...(SELF_TUNED_DRIVERS.has(driver) ? [] : DEFAULT_ARGS),
      ...(options.disableSandbox ? ['--no-sandbox'] : []),
      ...(options.args ?? []),
    ],
    ...(options.executablePath ? { executablePath: options.executablePath } : {}),
    ...(options.channel ? { channel: options.channel } : {}),
    ...(options.proxy ? { proxy: options.proxy } : {}),
  };
}

/**
 * Поднимает браузер по настройкам.
 *
 * Тем же путём, что и {@link solveTurnstile}: те же флаги, тот же порядок драйверов.
 * Пригодится, чтобы поднять браузер один раз на несколько токенов и передать его
 * в `browser`, — и чтобы проверять связки драйвера и сборки ровно в том виде,
 * в каком их поднимает пакет.
 */
export async function launchBrowser(options: BrowserOptions): Promise<Browser> {
  if (options.launch) return options.launch();

  if (options.driver !== undefined && !DRIVER_NAME.test(options.driver)) {
    throw new TypeError(`driver должен быть именем пакета, получено: ${options.driver}`);
  }

  const {
    driver,
    module: { chromium },
  } = await loadDriver(options.driver);
  const launchOptions = resolveLaunchOptions(options, driver);

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
