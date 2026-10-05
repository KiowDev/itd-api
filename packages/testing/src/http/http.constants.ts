/** HTTP-методы, поддерживаемые средствами тестирования. */
export const HttpMethod = Object.freeze({
  Get: 'GET',
  Post: 'POST',
  Put: 'PUT',
  Patch: 'PATCH',
  Delete: 'DELETE',
  Head: 'HEAD',
  Options: 'OPTIONS',
} as const);

export type HttpMethod = (typeof HttpMethod)[keyof typeof HttpMethod];

/** Вид сохранённого тела запроса. */
export const RecordedBodyType = Object.freeze({
  Empty: 'empty',
  Json: 'json',
  FormData: 'form-data',
  Text: 'text',
  Binary: 'binary',
} as const);

export type RecordedBodyType = (typeof RecordedBodyType)[keyof typeof RecordedBodyType];
