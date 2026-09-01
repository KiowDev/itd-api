import type { Page } from '../driver.js';
import type { CaptchaHandler } from '../handler.js';
import { buildWidgetPage, embed } from '../html.js';
import { requireText, resolveOrigin } from '../options.js';
import { CaptchaType, type Theme, type WidgetState } from '../types.js';

/** Базовый адрес виджета собственной капчи ИТД. Домен в punycode: `captcha.итд.com`. */
export const DEFAULT_CAPTCHA_ORIGIN = 'https://captcha.xn--d1ah4a.com';

/**
 * Публичный ключ виджета собственной капчи ИТД.
 *
 * Как и ключ Turnstile, он публичный и привязан к домену итд.com: виджет отдаёт его браузеру
 * каждому посетителю.
 */
export const ITD_CAPTCHA_SITE_KEY = 'sk_44d64cf7bf8bc8377f5b';

/** Назначение токена по умолчанию. Сервер сверяет его с операцией. */
const DEFAULT_ACTION = 'login';

/** Размеры карточки, px. Их же виджет сообщает сайту через `postMessage`. */
const WIDTH = 300;
const HEIGHT = 74;

/** Насколько правее левого края контейнера находится чекбокс, px. */
const CHECKBOX_OFFSET_X = 34;

/**
 * Собирает страницу с одним виджетом собственной капчи ИТД.
 *
 * Виджет — iframe чужого происхождения (`captcha.итд.com`), и наружу он отдаёт токен
 * единственным способом: `postMessage` в родителя. Эта страница ровно так его и слушает —
 * как сам сайт.
 *
 * Слушатель кладёт результат в скрытые поля, а не в переменную `window`: стелс-драйверы вроде
 * `patchright` выполняют `page.evaluate` в изолированном мире, откуда переменные страницы
 * не видны, зато DOM общий.
 *
 * `action` задаёт назначение токена (`login`, `register`, `password_reset`) — сервер сверяет
 * его с операцией, поэтому он не выдумывается, а приходит из настроек обработчика.
 */
export function buildItdCaptchaPage(input: {
  sitekey: string;
  theme: Theme;
  action: string;
  captchaOrigin: string;
}): string {
  const origin = embed(input.captchaOrigin);
  const src = embed(
    `${input.captchaOrigin}/widget.html` +
      `?sitekey=${encodeURIComponent(input.sitekey)}` +
      `&theme=${encodeURIComponent(input.theme)}` +
      `&action=${encodeURIComponent(input.action)}`,
  );

  return buildWidgetPage({
    title: 'Проверка',
    width: WIDTH,
    height: HEIGHT,
    widgetStyle: `
    border: 0;
    display: block;`,
    head: `<script>
  window.addEventListener('message', function (event) {
    if (event.origin !== ${origin}) return;
    var data;
    try {
      data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
    } catch (e) {
      return;
    }
    if (!data) return;
    var token = document.getElementById('itd-token');
    var error = document.getElementById('itd-error');
    if (data.type === 'token' && data.token) token.value = data.token;
    else if (data.type === 'expired') token.value = '';
    else if (data.type === 'error') error.value = String(data.code || 'error');
  });
</script>`,
    body: `<input type="hidden" id="itd-token">
<input type="hidden" id="itd-error">
<iframe id="widget" src=${src} title="Проверка"></iframe>`,
  });
}

/**
 * Читает результат виджета капчи ИТД.
 *
 * Токен приходит в родителя через `postMessage`, и слушатель страницы кладёт его в скрытое
 * поле. Читаем из DOM, а не из `window`: стелс-драйверы выполняют `evaluate` в изолированном
 * мире, где переменных страницы нет, а DOM общий.
 */
function readState(page: Page): Promise<WidgetState> {
  return page.evaluate<WidgetState>(() => {
    const token = document.querySelector('#itd-token') as { value?: string } | null;
    const error = document.querySelector('#itd-error') as { value?: string } | null;
    return {
      token: token?.value || null,
      error: error?.value || null,
    };
  });
}

/** Настройки виджета собственной капчи ИТД. */
export interface ItdCaptchaOptions {
  /** Публичный ключ виджета. По умолчанию {@link ITD_CAPTCHA_SITE_KEY} — ключ итд.com. */
  sitekey?: string | undefined;
  /**
   * Назначение токена: `login`, `register`, `password_reset`. По умолчанию `login`.
   *
   * Сервер сверяет назначение с операцией, поэтому для регистрации или сброса пароля нужен
   * токен с соответствующим `action`.
   */
  action?: string | undefined;
  /** Базовый адрес виджета. По умолчанию {@link DEFAULT_CAPTCHA_ORIGIN}. */
  captchaOrigin?: string | undefined;
}

/**
 * Создаёт обработчик собственной капчи ИТД.
 *
 * @throws {TypeError} при некорректных настройках
 */
export function itdCaptcha(options: ItdCaptchaOptions = {}): CaptchaHandler {
  const sitekey = requireText(options.sitekey ?? ITD_CAPTCHA_SITE_KEY, 'sitekey');
  const action = requireText(options.action ?? DEFAULT_ACTION, 'action');
  const captchaOrigin = resolveOrigin(
    options.captchaOrigin ?? DEFAULT_CAPTCHA_ORIGIN,
    'captchaOrigin',
  );

  return {
    type: CaptchaType.Itd,
    label: 'капчи ИТД',
    buildPage: ({ theme }) => buildItdCaptchaPage({ sitekey, theme, action, captchaOrigin }),
    widgetReadySelector: '#widget',
    checkboxOffsetX: CHECKBOX_OFFSET_X,
    readState,
    // Виджет ИТД шлёт лишь общий код ошибки и просит повторить: постоянных кодов у него нет.
    isPermanentWidgetError: () => false,
  };
}
