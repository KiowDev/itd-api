import type { CaptchaHandler } from '../handler.js';
import { type CaptchaType, CaptchaType as CaptchaTypeValues } from '../types.js';
import { itdCaptcha } from './itd.js';
import { turnstile } from './turnstile.js';

/**
 * Встроенные обработчики по имени провайдера.
 *
 * Имена — те же, какими провайдера называет сервер итд.com, поэтому значение из
 * `itd.auth.captchaProvider()` подходит как есть. `turnstile` принимается синонимом
 * `cloudflare`.
 */
const BUILT_IN: Readonly<Record<string, () => CaptchaHandler>> = Object.freeze({
  [CaptchaTypeValues.Itd]: itdCaptcha,
  [CaptchaTypeValues.Cloudflare]: turnstile,
  turnstile,
});

/** Что решать: имя известного провайдера либо свой обработчик. */
export type CaptchaTarget = CaptchaType | CaptchaHandler;

function isHandler(value: unknown): value is CaptchaHandler {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as CaptchaHandler).type === 'string' &&
    typeof (value as CaptchaHandler).buildPage === 'function' &&
    typeof (value as CaptchaHandler).readState === 'function'
  );
}

/**
 * Находит обработчик по имени провайдера либо принимает готовый.
 *
 * @throws {TypeError} если имя незнакомо или передано не то
 */
export function resolveHandler(target: CaptchaTarget): CaptchaHandler {
  if (isHandler(target)) return target;

  if (typeof target !== 'string' || target.trim() === '') {
    throw new TypeError(
      'Тип капчи должен быть именем провайдера или объектом CaptchaHandler, ' +
        `получено: ${typeof target}`,
    );
  }

  const factory = BUILT_IN[target];
  if (!factory) {
    throw new TypeError(
      `Неизвестный тип капчи: ${target}. Известны ${Object.keys(BUILT_IN).join(', ')}. ` +
        'Свой провайдер передайте объектом CaptchaHandler.',
    );
  }

  return factory();
}
