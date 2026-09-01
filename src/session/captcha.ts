import { ItdConfigError } from '../core/errors.js';
import { isRecord } from '../core/validate.js';
import { CAPTCHA_FIELDS, type CaptchaProvider, type CaptchaToken } from '../operations/auth.js';
import { CaptchaChoice, type CaptchaField, type CaptchaType } from '../types/enums.js';
import type { CaptchaSolver } from './options.js';

/** Капча запросов, которые её требуют: входа, регистрации, сброса пароля и QR-подтверждения. */

/** Готовый фрагмент тела запроса: имя поля и токен в нём. */
export type CaptchaBody = Record<string, string>;

function requireCaptchaText(value: unknown, field: string): void {
  if (value !== undefined && (typeof value !== 'string' || value.trim() === '')) {
    throw new ItdConfigError(`${field} должен быть непустой строкой`);
  }
}

/**
 * Проверяет форму источника токена и приводит его к объекту.
 *
 * Сам объект сохраняется как есть: `getToken` вызывается на нём, чтобы источнику остался
 * доступен собственный `this`.
 *
 * @throws {ItdConfigError} при некорректных значениях
 */
export function resolveCaptchaSolver(captcha: unknown): CaptchaSolver | undefined {
  if (captcha === undefined) return undefined;

  if (typeof captcha === 'function') {
    return { getToken: captcha as CaptchaSolver['getToken'] };
  }

  if (!isRecord(captcha)) {
    throw new ItdConfigError('captcha должен быть функцией либо объектом с getToken');
  }

  const { getToken, type, field } = captcha as Record<string, unknown>;

  if (typeof getToken !== 'function') {
    throw new ItdConfigError('captcha.getToken должен быть функцией');
  }
  requireCaptchaText(type, 'captcha.type');
  requireCaptchaText(field, 'captcha.field');

  return captcha as unknown as CaptchaSolver;
}

/**
 * Проверяет форму готового токена капчи.
 *
 * @param path имя опции или аргумента для текста ошибки
 * @throws {ItdConfigError} если токен или его тип не указаны
 */
export function validateCaptchaToken(captcha: unknown, path: string): void {
  if (captcha === undefined) return;
  if (!isRecord(captcha)) {
    throw new ItdConfigError(`${path} должен быть объектом { type, token }`);
  }

  const { type, token, field } = captcha as Record<string, unknown>;

  if (typeof token !== 'string' || token.trim() === '') {
    throw new ItdConfigError(`${path}.token должен быть непустой строкой`);
  }
  if (typeof type !== 'string' || type.trim() === '') {
    throw new ItdConfigError(`${path}.type должен быть непустой строкой`);
  }
  requireCaptchaText(field, `${path}.field`);
}

/** Разбирает ответ `GET /api/v1/auth/captcha/provider` для автоматического входа. */
export function readCaptchaProvider(body: unknown): CaptchaProvider {
  const config = isRecord(body) ? (body as Record<string, unknown>) : undefined;
  const provider = config?.provider;
  const field = config?.field;

  if (
    typeof provider !== 'string' ||
    provider.trim() === '' ||
    typeof field !== 'string' ||
    field.trim() === ''
  ) {
    throw new ItdConfigError('Сервер вернул неподдерживаемую конфигурацию капчи');
  }

  return { provider, field };
}

/** Куда класть токен: настройка, иначе умолчание провайдера. */
function resolveField(type: CaptchaType, configured: CaptchaField | undefined): CaptchaField {
  const field = configured ?? CAPTCHA_FIELDS[type as keyof typeof CAPTCHA_FIELDS];
  if (field) return field;

  throw new ItdConfigError(
    `Неизвестно, в каком поле сервер ждёт токен капчи «${type}». Передайте captcha.field ` +
      `либо оставьте captcha.type = ${CaptchaChoice.Auto}, чтобы поле назвал сервер.`,
  );
}

/** Спрашивает токен у источника и убеждается, что он непустой. */
async function requireSolvedToken(solver: CaptchaSolver, type: CaptchaType): Promise<string> {
  const token = await solver.getToken(type);
  if (typeof token === 'string' && token.trim() !== '') return token;

  throw new ItdConfigError(
    `Источник капчи не вернул токен для провайдера «${type}». Проверьте captcha.getToken.`,
  );
}

/**
 * Готовит фрагмент тела запроса, взяв токен у источника.
 *
 * При `CaptchaChoice.Auto` провайдер спрашивается у сервера — тогда и тип виджета,
 * и имя поля приходят оттуда. Явно названный тип обходится без этого запроса.
 *
 * @param askProvider как спросить активного провайдера; вызывается, только если это нужно
 * @throws {ItdConfigError} если токен получить не удалось
 */
export async function solveCaptchaBody(
  solver: CaptchaSolver,
  askProvider: () => Promise<CaptchaProvider>,
): Promise<CaptchaBody> {
  const choice = solver.type ?? CaptchaChoice.Auto;

  if (choice === CaptchaChoice.Auto) {
    const { provider, field } = await askProvider();
    return { [field]: await requireSolvedToken(solver, provider) };
  }

  return { [resolveField(choice, solver.field)]: await requireSolvedToken(solver, choice) };
}

/**
 * Готовит фрагмент тела из готового токена.
 *
 * Поле берётся из самого токена либо из умолчания провайдера; запроса к серверу нет.
 *
 * @throws {ItdConfigError} если токен или его тип не указаны
 */
export function captchaBody(captcha: CaptchaToken): CaptchaBody {
  validateCaptchaToken(captcha, 'captcha');

  return { [resolveField(captcha.type, captcha.field)]: captcha.token };
}
