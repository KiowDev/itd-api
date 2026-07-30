/** Ширина контейнера виджета, px. Столько же занимает виджет на самом сайте. */
export const WIDGET_WIDTH = 300;
/** Высота контейнера виджета, px. */
export const WIDGET_HEIGHT = 65;

/** Куда страница кладёт результат. Читается через `page.evaluate`. */
export interface WidgetState {
  token: string | null;
  error: string | null;
}

/**
 * Готовит значение к вставке в инлайновый скрипт.
 *
 * Одного `JSON.stringify` мало: кавычки он экранирует, а `</script>` — нет, и такая
 * последовательность закрывает тег независимо от того, внутри строки она или нет.
 * Экранированный `<` разбирается движком как обычный символ, но парсер HTML его уже не видит.
 */
function embed(value: string): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

/**
 * Собирает страницу с одним виджетом Turnstile.
 *
 * Страница отдаётся вместо настоящей — по адресу целевого сайта, через перехват навигации.
 * Благодаря этому `document.location.origin` для виджета настоящий, и привязка ключа
 * к домену не нарушается: Cloudflare вернёт серверу тот же hostname, что и при входе
 * с живого сайта.
 *
 * Виджет создаётся так же, как это делает сам сайт, — скриптом с `?onload=` и явным
 * `turnstile.render` с одним лишь `sitekey`. Ни `action`, ни `cdata` сайт не передаёт,
 * поэтому их не передаёт и эта страница: лишний параметр попал бы в ответ `siteverify`
 * и мог бы разойтись с тем, что ожидает сервер.
 */
export function buildWidgetPage(sitekey: string, theme: 'auto' | 'light' | 'dark'): string {
  const key = embed(sitekey);
  const widgetTheme = embed(theme);

  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>Turnstile</title>
<style>
  html, body { margin: 0; padding: 0; background: #fff; }
  #widget {
    width: ${WIDGET_WIDTH}px;
    height: ${WIDGET_HEIGHT}px;
    margin: 40px;
  }
</style>
<script>
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
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad" async defer></script>
</head>
<body><div id="widget"></div></body>
</html>`;
}
