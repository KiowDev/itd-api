/**
 * Сборка страницы, на которой живёт виджет.
 *
 * Страница отдаётся вместо настоящей — по адресу целевого сайта, через перехват навигации.
 * Благодаря этому `document.location.origin` для виджета настоящий, и привязка ключа
 * к домену не нарушается, а форма входа и пароль в браузере не участвуют.
 *
 * Каркас общий для всех провайдеров: контейнер `#widget` известного размера, от которого
 * общий цикл отсчитывает координаты клика. Различия провайдеров — в `head` и `body`.
 */

/** Отступ контейнера от края окна, px. Виджету нужно место, чтобы раскрыть карточку. */
const WIDGET_MARGIN = 40;

/**
 * Готовит значение к вставке в инлайновый скрипт или атрибут.
 *
 * Одного `JSON.stringify` мало: кавычки он экранирует, а `</script>` — нет, и такая
 * последовательность закрывает тег независимо от того, внутри строки она или нет.
 * Экранированный `<` разбирается движком как обычный символ, но парсер HTML его уже не видит.
 */
export function embed(value: string): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

/** Из чего собирается страница одного виджета. */
export interface PageParts {
  /** Заголовок вкладки. На проверку не влияет, но пустой заголовок выглядит подозрительно. */
  title: string;
  /** Размеры контейнера `#widget`, px. Столько же виджет занимает на самом сайте. */
  width: number;
  height: number;
  /** Дополнительные правила для `#widget` — например, если контейнер сам является iframe. */
  widgetStyle?: string | undefined;
  /** Содержимое `head`: скрипты и обработчики провайдера. */
  head?: string | undefined;
  /** Содержимое `body`: сам контейнер `#widget` и поля для результата. */
  body: string;
}

/** Собирает страницу с одним виджетом. */
export function buildWidgetPage(parts: PageParts): string {
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>${parts.title}</title>
<style>
  html, body { margin: 0; padding: 0; background: #fff; }
  #widget {
    width: ${parts.width}px;
    height: ${parts.height}px;
    margin: ${WIDGET_MARGIN}px;${parts.widgetStyle ?? ''}
  }
</style>
${parts.head ?? ''}
</head>
<body>
${parts.body}
</body>
</html>`;
}
