import type { Page } from '../driver.js';
import type { CaptchaHandler } from '../handler.js';
import { buildWidgetPage, embed } from '../html.js';
import { requireText } from '../options.js';
import { CaptchaType, type Theme, type WidgetState } from '../types.js';

/**
 * Публичный ключ виджета Cloudflare Turnstile на итд.com.
 *
 * Ключ публичный — виджет отдаёт его браузеру каждому посетителю — и привязан к домену
 * итд.com, поэтому больше ни для чего не годится. Держим его прямо в пакете: это его данные,
 * а не пользовательская настройка. Тот же ключ экспортирует `itd-api`.
 */
export const TURNSTILE_SITE_KEY = '0x4AAAAAACHhxczw6fJGwPBg';

/** Размеры контейнера виджета, px. Столько же он занимает на самом сайте. */
const WIDTH = 300;
const HEIGHT = 65;

/** Насколько правее левого края контейнера находится чекбокс, px. */
const CHECKBOX_OFFSET_X = 30;

/** Коды Cloudflare вида `110***` означают, что ключ не разрешён для домена. */
const DOMAIN_ERROR_PREFIX = '110';

/**
 * Собирает страницу с одним виджетом Cloudflare Turnstile.
 *
 * Виджет создаётся так же, как это делает сам сайт, — скриптом с `?onload=` и явным
 * `turnstile.render` с одним лишь `sitekey`. Ни `action`, ни `cdata` сайт не передаёт,
 * поэтому их не передаёт и эта страница: лишний параметр попал бы в ответ `siteverify`
 * и мог бы разойтись с тем, что ожидает сервер.
 */
export function buildTurnstilePage(sitekey: string, theme: Theme): string {
  const key = embed(sitekey);
  const widgetTheme = embed(theme);

  return buildWidgetPage({
    title: 'Turnstile',
    width: WIDTH,
    height: HEIGHT,
    head: `<script>
  window.__itdToken = null;
  window.__itdError = null;
  window.onTurnstileLoad = function () {
    var reset = function () {
      window.__itdToken = null;
      if (widgetId !== undefined) window.turnstile.reset(widgetId);
    };
    var widgetId = window.turnstile.render('#widget', {
      sitekey: ${key},
      theme: ${widgetTheme},
      callback: function (token) { window.__itdToken = token; },
      'error-callback': function (code) { window.__itdError = String(code || 'unknown'); return true; },
      'timeout-callback': reset,
      'expired-callback': reset
    });
  };
</script>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad" async defer></script>`,
    body: '<div id="widget"></div>',
  });
}

/**
 * Читает результат виджета Turnstile.
 *
 * Источников два. Скрытое поле `cf-turnstile-response` виджет заполняет всегда, а вот
 * `callback` срабатывает не в каждом сценарии: пройдясь сам, виджет успевает убрать iframe,
 * и обработчика можно не дождаться. Поле при этом остаётся заполненным, и лежит оно
 * в нашей странице, а не внутри iframe чужого происхождения, поэтому доступно.
 */
function readState(page: Page): Promise<WidgetState> {
  return page.evaluate<WidgetState>(() => {
    const field = document.querySelector('input[name="cf-turnstile-response"]') as {
      value?: string;
    } | null;
    const scope = window as unknown as { __itdToken?: string | null; __itdError?: string | null };

    // Пустая строка в поле означает «ещё не решено», поэтому проверка на истинность.
    return {
      token: scope.__itdToken || field?.value || null,
      error: scope.__itdError ?? null,
    };
  });
}

/** Настройки виджета Cloudflare Turnstile. */
export interface TurnstileOptions {
  /** Публичный ключ виджета. По умолчанию {@link TURNSTILE_SITE_KEY} — ключ итд.com. */
  sitekey?: string | undefined;
}

/**
 * Создаёт обработчик Cloudflare Turnstile.
 *
 * @throws {TypeError} при некорректных настройках
 */
export function turnstile(options: TurnstileOptions = {}): CaptchaHandler {
  const sitekey = requireText(options.sitekey ?? TURNSTILE_SITE_KEY, 'sitekey');

  return {
    type: CaptchaType.Cloudflare,
    label: 'Turnstile',
    buildPage: ({ theme }) => buildTurnstilePage(sitekey, theme),
    // Обёртка, а не iframe внутри неё: пройдясь без участия человека, виджет iframe убирает,
    // и ожидание iframe проспало бы уже готовый токен.
    widgetReadySelector: '#widget > div',
    checkboxOffsetX: CHECKBOX_OFFSET_X,
    readState,
    isPermanentWidgetError: (code) => code.startsWith(DOMAIN_ERROR_PREFIX),
  };
}
