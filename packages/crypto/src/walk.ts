import type { Cipher, Secret } from './cipher.js';
import { SECRET_FIELDS } from './fields.js';

/**
 * Глубина обхода.
 *
 * Самый глубокий ответ API — репост поста с комментариями и авторами внутри, а это
 * пять-шесть уровней. Ограничение защищает от неожиданно длинных цепочек, а не от циклов:
 * от них есть отдельная проверка.
 */
const MAX_DEPTH = 12;

/**
 * Ищет скрытые сообщения во всём ответе и вешает находки на те же объекты.
 *
 * Обход, а не разбор конкретных ответов: одним проходом покрываются лента, страницы,
 * `originalPost`, `comments`, `replies`, `author` и результаты поиска — без отдельной
 * поддержки каждого эндпоинта. Поля исходного ответа не меняются: расшифровка приезжает
 * рядом, в `secret` и `secrets`.
 *
 * @param value разобранное тело ответа; изменяется на месте
 */
export function decodeTree(value: unknown, ciphers: readonly Cipher[]): void {
  if (ciphers.length === 0) return;

  walk(value, ciphers, 0, new WeakSet<object>());
}

function walk(value: unknown, ciphers: readonly Cipher[], depth: number, seen: WeakSet<object>) {
  if (depth > MAX_DEPTH || typeof value !== 'object' || value === null) return;
  if (seen.has(value)) return;
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) walk(item, ciphers, depth + 1, seen);
    return;
  }

  const record = value as Record<string, unknown>;
  const secrets = readSecrets(record, ciphers);

  // Список полей снимается до присвоения: заходить внутрь собственных находок незачем.
  const nested = Object.values(record);

  if (secrets.length > 0) {
    // Краткая форма для обычного случая — у поста и комментария текстовое поле одно.
    record.secret = secrets[0];
    record.secrets = secrets;
  }

  for (const item of nested) walk(item, ciphers, depth + 1, seen);
}

function readSecrets(record: Record<string, unknown>, ciphers: readonly Cipher[]): Secret[] {
  const secrets: Secret[] = [];

  for (const field of SECRET_FIELDS) {
    const text = record[field];
    if (typeof text !== 'string' || text === '') continue;

    for (const cipher of ciphers) {
      const decoded = cipher.decode(text);
      // Первый прочитавший и выигрывает: два шифра на одном тексте не уживаются,
      // а перебирать остальные после успеха незачем.
      if (decoded !== null) {
        secrets.push({ cipher: cipher.name, field, text: decoded });
        break;
      }
    }
  }

  return secrets;
}
