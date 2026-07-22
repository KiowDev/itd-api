/** Где в теле запроса лежит пользовательский текст. */
export interface TextRoute {
  method: string;
  /** Путь без базового URL и без строки запроса. */
  path: RegExp;
  /** Поля тела, которые можно зашифровать. Первое считается основным. */
  fields: readonly string[];
}

/**
 * Эндпоинты, принимающие текст от пользователя.
 *
 * Плагин работает на уровне транспорта и подсказок от клиента не получает, поэтому
 * сопоставляет запрос с этой таблицей сам. Пути повторяют те, что собирают ресурсы
 * `itd.posts`, `itd.comments` и `itd.users`.
 *
 * Эндпоинтов с текстом больше — жалобы, опросы, — но прятать сообщение там негде:
 * его никто не увидит.
 */
export const TEXT_ROUTES: readonly TextRoute[] = Object.freeze([
  { method: 'POST', path: /^\/api\/posts$/, fields: ['content'] },
  { method: 'PUT', path: /^\/api\/posts\/[^/]+$/, fields: ['content'] },
  { method: 'POST', path: /^\/api\/posts\/[^/]+\/repost$/, fields: ['content'] },
  { method: 'POST', path: /^\/api\/posts\/[^/]+\/comments$/, fields: ['content'] },
  { method: 'POST', path: /^\/api\/comments\/[^/]+\/replies$/, fields: ['content'] },
  { method: 'PATCH', path: /^\/api\/comments\/[^/]+$/, fields: ['content'] },
  { method: 'PUT', path: /^\/api\/users\/me$/, fields: ['displayName', 'bio'] },
  { method: 'POST', path: /^\/api\/users\/profile$/, fields: ['displayName'] },
]);

/**
 * Поля ответа, которые проверяются на скрытое сообщение.
 *
 * Имена, а не типы объектов: ответ обходится целиком, и одного списка хватает и посту,
 * и комментарию, и профилю, и автору внутри них.
 *
 * Текста уведомления (`preview`) здесь нет намеренно: библиотека пересобирает уведомления
 * в единую форму уже после плагина, и находка до вызывающего кода не доедет.
 */
export const SECRET_FIELDS: readonly string[] = Object.freeze(['content', 'bio', 'displayName']);

/** Какие поля можно зашифровать в этом запросе. `undefined` — эндпоинт текста не принимает. */
export function textFields(method: string, path: string): readonly string[] | undefined {
  const normalized = method.toUpperCase();

  for (const route of TEXT_ROUTES) {
    if (route.method === normalized && route.path.test(path)) return route.fields;
  }

  return undefined;
}
