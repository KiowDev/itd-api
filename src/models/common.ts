import type { SpanType } from '../types/enums.js';

/**
 * Дата и время в формате ISO-8601, например `2026-07-21T14:30:00.000Z`.
 *
 * Библиотека не превращает такие поля в `Date`: строку проще сравнивать, логировать
 * и передавать дальше без потерь. Для разбора есть `toDate()`.
 */
export type IsoDate = string;

/**
 * Идентификатор пользователя — **строго UUID**.
 *
 * Отличается от {@link UserRef} тем, что имя пользователя здесь не подойдёт. Так помечены
 * места, где API принимает только UUID: например `wallRecipientId` при постинге на чужую стену.
 */
export type UserId = string;

/**
 * Ссылка на пользователя: **UUID либо имя пользователя**.
 *
 * Пути вида `/api/users/{id}` принимают оба варианта, поэтому `itd.users.get('nowkie')`
 * работает так же, как `itd.users.get('9f1c…')`.
 */
export type UserRef = string;

/**
 * Разметка в тексте поста или комментария.
 *
 * `offset` и `length` измеряются в UTF-16 code units: это те же индексы, которые используют
 * `String#slice`, `substring` и DOM Selection в JavaScript. Эмодзи вне BMP обычно занимают
 * две единицы.
 */
export interface Span {
  /** Тип фрагмента — см. {@link SpanType}. */
  type: SpanType;
  /** Смещение от начала текста. */
  offset: number;
  /** Длина фрагмента. */
  length: number;
  /** Имя хэштега без решётки. У старых mention-объектов может содержать username. */
  tag?: string;
  /** Адрес ссылки. Только у `link`: у него вместо `tag` отдельное поле. */
  url?: string;
  /** Имя пользователя у `mention`. */
  username?: string;
  /** Идентификатор пользователя у некоторых ответов API с `mention`. */
  id?: string;
}
