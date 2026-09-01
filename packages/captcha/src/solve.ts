import { resolveOptions, type SolveOptions } from './options.js';
import { type CaptchaTarget, resolveHandler } from './providers/registry.js';
import { runSolver } from './runner.js';
import type { CaptchaType } from './types.js';

/**
 * Получает один токен капчи указанного типа.
 *
 * Поднимает браузер, решает виджет и закрывает браузер за собой.
 *
 * @example
 * ```ts
 * await solveCaptcha(CaptchaType.Itd);
 * await solveCaptcha(itdCaptcha({ action: 'register' }), { headless: true });
 * await solveCaptcha(myOwnHandler);
 * ```
 *
 * @throws {CaptchaError} если токен получить не удалось
 * @throws {TypeError} при некорректных настройках или незнакомом типе
 */
export async function solveCaptcha(
  target: CaptchaTarget,
  options: SolveOptions = {},
): Promise<string> {
  const handler = resolveHandler(target);
  return runSolver(handler, resolveOptions(options));
}

/** Настройки источника токена для клиента `itd-api`. */
export interface CaptchaSolverOptions extends SolveOptions {
  /**
   * Какую капчу проходить всегда: `CaptchaType.Itd`, `CaptchaType.Cloudflare` либо готовый
   * провайдер из фабрики.
   *
   * Без этой настройки тип называет клиент, спросив активного провайдера у сервера.
   * Сервер принимает обе капчи, так что закреплённый тип избавляет от лишнего запроса.
   */
  type?: CaptchaTarget | undefined;
  /**
   * Поле тела запроса, в котором сервер ждёт токен.
   *
   * Нужно, только если сервер его переименовал: для закреплённого типа клиент берёт имя
   * из своей таблицы. Задаётся вместе с {@link CaptchaSolverOptions.type}.
   */
  field?: string | undefined;
}

/** Источник токена капчи для опции `captcha` клиента `itd-api`. */
export interface CaptchaSolver {
  /** Получает имя провайдера, чью капчу нужно пройти, и возвращает токен. */
  getToken(type: CaptchaType): Promise<string>;
  /** Тип, закреплённый за источником. Без него тип выбирает клиент. */
  readonly type?: CaptchaType | undefined;
  /** Поле тела запроса для закреплённого типа. */
  readonly field?: string | undefined;
}

/**
 * Собирает источник токена капчи для клиента `itd-api`.
 *
 * Токен одноразовый и живёт несколько минут, поэтому клиент спрашивает его заново перед
 * каждым запросом, которому нужна капча. Браузер поднимается на время одного вызова
 * и сразу закрывается.
 *
 * @throws {TypeError} если тип капчи незнаком или `field` задан без него
 *
 * @example
 * ```ts
 * import { ItdClient } from 'itd-api';
 * import { FileTokenStorage } from 'itd-api/node';
 * import { createCaptchaSolver, CaptchaType } from '@itd-api/captcha';
 *
 * const itd = new ItdClient({
 *   storage: new FileTokenStorage('./.itd-session.json'),
 *   auth: { email: process.env.ITD_EMAIL!, password: process.env.ITD_PASSWORD! },
 *   captcha: createCaptchaSolver({ type: CaptchaType.Cloudflare }),
 * });
 * ```
 */
export function createCaptchaSolver(options: CaptchaSolverOptions = {}): CaptchaSolver {
  const { type, field, ...solveOptions } = options;

  if (type === undefined) {
    return { getToken: (requested) => solveCaptcha(requested, solveOptions) };
  }

  // Обработчик собирается сразу: незнакомый тип должен разбираться при создании клиента,
  // а не в момент входа.
  const handler = resolveHandler(type);
  const resolved = resolveOptions(solveOptions);

  return {
    type: handler.type,
    ...(field === undefined ? {} : { field }),
    getToken: () => runSolver(handler, resolved),
  };
}
