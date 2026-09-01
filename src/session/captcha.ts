import { ItdConfigError } from '../core/errors.js';
import { isRecord } from '../core/validate.js';
import { CAPTCHA_FIELDS, type CaptchaProvider, type CaptchaToken } from '../operations/auth.js';
import { CaptchaChoice, type CaptchaField, type CaptchaType } from '../types/enums.js';
import type { CaptchaOptions } from './options.js';

/**
 * Капча при входе по логину и паролю.
 *
 * При `CaptchaChoice.Auto` тип виджета и имя поля приходят от сервера; названный тип
 * решается без запроса, а поле берётся из настройки или из {@link CAPTCHA_FIELDS}.
 */

/** Готовый фрагмент тела запроса: имя поля и токен в нём. */
export type CaptchaBody = Record<string, string>;

function requireCaptchaText(value: unknown, field: string): void {
  if (value !== undefined && (typeof value !== 'string' || value.trim() === '')) {
    throw new ItdConfigError(`${field} должен быть непустой строкой`);
  }
}

/**
 * Проверяет форму блока `auth.captcha`.
 *
 * Отсутствие источника токена ошибкой не считается: до входа по паролю дело может и не
 * дойти. О нехватке сообщит {@link resolveCaptchaBody} в момент входа.
 *
 * @throws {ItdConfigError} при некорректных значениях
 */
export function validateCaptchaOptions(captcha: unknown): void {
  if (captcha === undefined) return;
  if (!isRecord(captcha)) {
    throw new ItdConfigError('auth.captcha должен быть объектом');
  }

  const { type, token, getToken, field } = captcha as Record<string, unknown>;

  requireCaptchaText(type, 'auth.captcha.type');
  requireCaptchaText(token, 'auth.captcha.token');
  requireCaptchaText(field, 'auth.captcha.field');

  if (getToken !== undefined && typeof getToken !== 'function') {
    throw new ItdConfigError('auth.captcha.getToken должен быть функцией');
  }
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
    `Неизвестно, в каком поле сервер ждёт токен капчи «${type}». Передайте auth.captcha.field ` +
      `либо оставьте auth.captcha.type = ${CaptchaChoice.Auto}, чтобы поле назвал сервер.`,
  );
}

/** Спрашивает свежий токен, затем берёт разовый. */
async function resolveToken(captcha: CaptchaOptions, type: CaptchaType): Promise<string> {
  const fresh = await captcha.getToken?.(type);
  const token = fresh || captcha.token;
  if (token) return token;

  throw new ItdConfigError(
    `Источник капчи не вернул токен для провайдера «${type}». Проверьте auth.captcha.getToken.`,
  );
}

/**
 * Готовит фрагмент тела запроса с токеном капчи.
 *
 * При `CaptchaChoice.Auto` провайдер спрашивается у сервера — тогда и тип виджета,
 * и имя поля приходят оттуда. Явно названный тип решается без этого запроса.
 *
 * @param askProvider как спросить активного провайдера; вызывается, только если это нужно
 * @throws {ItdConfigError} если капча не настроена или токен не получен
 */
export async function resolveCaptchaBody(
  captcha: CaptchaOptions | undefined,
  askProvider: () => Promise<CaptchaProvider>,
): Promise<CaptchaBody> {
  // Проверка до запроса провайдера: без источника токена вход всё равно не состоится.
  if (!captcha?.token && !captcha?.getToken) {
    throw new ItdConfigError(
      'Вход по email и паролю требует токен капчи. Передайте auth.captcha.getToken — источник ' +
        'свежего токена — либо разовый auth.captcha.token. В Node токен получает пакет ' +
        '@itd-api/captcha.',
    );
  }

  const choice = captcha.type ?? CaptchaChoice.Auto;

  if (choice === CaptchaChoice.Auto) {
    const { provider, field } = await askProvider();
    return { [field]: await resolveToken(captcha, provider) };
  }

  return { [resolveField(choice, captcha.field)]: await resolveToken(captcha, choice) };
}

/**
 * Готовит фрагмент тела для разового вызова с готовым доказательством.
 *
 * Поле берётся из самого доказательства либо из умолчания провайдера; запроса к серверу нет.
 *
 * @throws {ItdConfigError} если доказательство неполное
 */
export function captchaBody(captcha: CaptchaToken): CaptchaBody {
  if (!isRecord(captcha)) {
    throw new ItdConfigError('captcha должен быть объектом { type, token }');
  }
  if (typeof captcha.token !== 'string' || captcha.token.trim() === '') {
    throw new ItdConfigError('captcha.token должен быть непустой строкой');
  }
  if (typeof captcha.type !== 'string' || captcha.type.trim() === '') {
    throw new ItdConfigError('captcha.type должен быть непустой строкой');
  }

  return { [resolveField(captcha.type, captcha.field)]: captcha.token };
}
