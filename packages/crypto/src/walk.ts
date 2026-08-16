import type { Span } from 'itd-api';
import type {
  Cipher,
  CryptoDecodedObject,
  CryptoSpan,
  DecodedField,
  DecodedFields,
} from './cipher.js';
import { INVISIBLE_ALPHABET } from './ciphers/invisible.js';
import { responseFieldDefinition, SCANNED_FIELDS, type TextFieldDefinition } from './fields.js';
import { scanFrames } from './protocol.js';
import { CipherRegistry } from './registry.js';

const MAX_DEPTH = 12;
const INVISIBLE_RUN = new RegExp(`[${INVISIBLE_ALPHABET}]+`, 'gu');

interface WireReplacement {
  wireStart: number;
  wireEnd: number;
  decodedStart: number;
  decodedEnd: number;
  cipher: Cipher;
  text: string;
}

/**
 * Обходит произвольный результат и добавляет расшифрованные представления к найденным
 * объектам.
 *
 * Исходное дерево не изменяется. Если находок нет, функция возвращает тот же объект; если
 * находки есть, копируются только изменённые ветви. Строковые поля ответа и связанные
 * с ними серверные `spans` всегда сохраняются в первоначальном виде.
 *
 * Обычно вызывать функцию вручную не требуется: {@link crypt} применяет её к HTTP-ответам
 * и событиям автоматически. Она полезна при обработке ранее сохранённого ответа.
 *
 * @param value результат API, страница, массив или отдельная модель
 * @param ciphers шифры, которыми нужно распознавать данные
 * @returns исходное дерево либо его копия с полями `decoded`
 *
 * @example
 * ```ts
 * const result = decodeTree(savedPost, BUILT_IN_CIPHERS);
 * console.log(result.decoded?.content?.text);
 * ```
 */
export function decodeTree<T>(value: T, ciphers: readonly Cipher[]): T & CryptoDecodedObject {
  return decodeTreeWithFields(value, new CipherRegistry(ciphers), undefined);
}

/** @internal */
export function decodeTreeWithFields<T>(
  value: T,
  registry: CipherRegistry,
  additionalFields: readonly TextFieldDefinition[] | undefined,
): T & CryptoDecodedObject {
  const fields = responseFields(additionalFields);
  return cloneAndDecode(value, registry, fields, 0, new WeakMap<object, unknown>()) as T &
    CryptoDecodedObject;
}

function cloneAndDecode<T>(
  value: T,
  registry: CipherRegistry,
  fields: readonly TextFieldDefinition[],
  depth: number,
  copies: WeakMap<object, unknown>,
): T {
  if (depth > MAX_DEPTH || typeof value !== 'object' || value === null) return value;

  const existing = copies.get(value);
  if (existing !== undefined) return existing as T;
  copies.set(value, value);

  if (Array.isArray(value)) {
    const items = value.map((item) => cloneAndDecode(item, registry, fields, depth + 1, copies));
    if (items.every((item, index) => item === value[index])) return value;
    copies.set(value, items);
    return items as T;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;

  const source = value as Record<string, unknown>;
  const entries: Array<[string, unknown]> = [];
  let changed = false;
  for (const [key, item] of Object.entries(source)) {
    const transformed =
      key === 'raw' ? item : cloneAndDecode(item, registry, fields, depth + 1, copies);
    entries.push([key, transformed]);
    if (transformed !== item) changed = true;
  }

  const decoded = decodeRecord(source, registry, fields);
  if (!decoded && !changed) return value;

  const copy = Object.create(prototype) as Record<string, unknown>;
  for (const [key, item] of entries) copy[key] = item;
  if (decoded) copy.decoded = decoded;
  copies.set(value, copy);
  return copy as T;
}

function decodeRecord(
  record: Record<string, unknown>,
  registry: CipherRegistry,
  fields: readonly TextFieldDefinition[],
): DecodedFields | undefined {
  let decoded: DecodedFields | undefined;

  for (const definition of fields) {
    const wireText = record[definition.name];
    if (typeof wireText !== 'string' || wireText === '') continue;

    const serverSpans = definition.spansField ? readServerSpans(record[definition.spansField]) : [];
    const result = decodeField(
      wireText,
      serverSpans,
      definition.preservesInvisibleAlphabet,
      registry,
    );
    if (!result) continue;

    decoded ??= {};
    decoded[definition.name] = result;
  }

  return decoded;
}

function responseFields(
  additional: readonly TextFieldDefinition[] | undefined,
): TextFieldDefinition[] {
  const fields = SCANNED_FIELDS.flatMap((name) => {
    const definition = responseFieldDefinition(name);
    return definition ? [definition] : [];
  });
  const names = new Set(fields.map((field) => field.name));
  for (const field of additional ?? []) {
    if (!names.has(field.name)) fields.push(field);
  }
  return fields;
}

function decodeField(
  wireText: string,
  serverSpans: readonly Span[],
  preservesInvisibleAlphabet: boolean,
  registry: CipherRegistry,
): DecodedField | null {
  const replacements: WireReplacement[] = [];
  let occupiedFrames: Array<readonly [number, number]> = [];

  if (preservesInvisibleAlphabet) {
    const scanned = scanFrames(wireText, registry);
    occupiedFrames = scanned.occupied;
    for (const frame of scanned.matches) {
      replacements.push({
        wireStart: frame.start,
        wireEnd: frame.end,
        decodedStart: 0,
        decodedEnd: 0,
        cipher: frame.cipher,
        text: frame.text,
      });
    }
    replacements.push(...scanLegacyRuns(wireText, occupiedFrames, registry));
  }

  if (replacements.length === 0 && occupiedFrames.length === 0) {
    for (const cipher of registry.ordered) {
      if (cipher.supportsFragments || cipher.id === 0) continue;
      if (cipher.requiresInvisibleAlphabet && !preservesInvisibleAlphabet) continue;
      const text = registry.decode(cipher, wireText);
      if (text === null) continue;
      replacements.push({
        wireStart: 0,
        wireEnd: wireText.length,
        decodedStart: 0,
        decodedEnd: text.length,
        cipher,
        text,
      });
      break;
    }
  }

  if (replacements.length === 0) return null;
  replacements.sort((left, right) => left.wireStart - right.wireStart);

  const output: string[] = [];
  let wireCursor = 0;
  let decodedCursor = 0;
  for (const replacement of replacements) {
    const open = wireText.slice(wireCursor, replacement.wireStart);
    output.push(open, replacement.text);
    decodedCursor += open.length;
    replacement.decodedStart = decodedCursor;
    decodedCursor += replacement.text.length;
    replacement.decodedEnd = decodedCursor;
    wireCursor = replacement.wireEnd;
  }
  output.push(wireText.slice(wireCursor));

  const ordinary = serverSpans.map((span, index) => ({
    span: remapWireSpan(span, replacements),
    order: index,
    crypto: false as const,
  }));
  const crypto = mergeCryptoSpans(
    replacements.map((replacement) => ({
      type: 'crypto',
      cipher: replacement.cipher.name,
      cipherId: replacement.cipher.id,
      offset: replacement.decodedStart,
      length: replacement.decodedEnd - replacement.decodedStart,
    })),
  ).map((span, index) => ({ span, order: index, crypto: true as const }));

  const spans = [...ordinary, ...crypto]
    .sort(
      (left, right) =>
        left.span.offset - right.span.offset ||
        Number(left.crypto) - Number(right.crypto) ||
        left.order - right.order,
    )
    .map(({ span }) => span);

  return { text: output.join(''), spans };
}

function scanLegacyRuns(
  wireText: string,
  occupiedFrames: readonly (readonly [number, number])[],
  registry: CipherRegistry,
): WireReplacement[] {
  const legacy = registry.byId(0);
  if (!legacy) return [];

  const replacements: WireReplacement[] = [];
  const openSegments = subtractIntervals(wireText.length, occupiedFrames);

  for (const [segmentStart, segmentEnd] of openSegments) {
    const segment = wireText.slice(segmentStart, segmentEnd);
    for (const match of segment.matchAll(INVISIBLE_RUN)) {
      const payload = match[0];
      if (payload.length < 8 || match.index === undefined) continue;
      const text = registry.decode(legacy, payload);
      if (text === null) continue;
      const start = segmentStart + match.index;
      replacements.push({
        wireStart: start,
        wireEnd: start + payload.length,
        decodedStart: 0,
        decodedEnd: 0,
        cipher: legacy,
        text,
      });
    }
  }

  return replacements;
}

function subtractIntervals(
  length: number,
  intervals: readonly (readonly [number, number])[],
): Array<[number, number]> {
  const result: Array<[number, number]> = [];
  let cursor = 0;
  for (const [start, end] of intervals) {
    if (cursor < start) result.push([cursor, start]);
    cursor = Math.max(cursor, end);
  }
  if (cursor < length) result.push([cursor, length]);
  return result;
}

function remapWireSpan(span: Span, replacements: readonly WireReplacement[]): Span {
  const start = mapWirePosition(span.offset, 'start', replacements);
  const end = mapWirePosition(span.offset + span.length, 'end', replacements);
  return { ...span, offset: start, length: end - start };
}

function mapWirePosition(
  position: number,
  side: 'start' | 'end',
  replacements: readonly WireReplacement[],
): number {
  let delta = 0;
  for (const replacement of replacements) {
    if (position < replacement.wireStart) break;
    if (position === replacement.wireStart) return replacement.decodedStart;
    if (position < replacement.wireEnd) {
      return side === 'start' ? replacement.decodedStart : replacement.decodedEnd;
    }
    if (position === replacement.wireEnd) return replacement.decodedEnd;
    delta +=
      replacement.decodedEnd -
      replacement.decodedStart -
      (replacement.wireEnd - replacement.wireStart);
  }
  return position + delta;
}

function mergeCryptoSpans(spans: readonly CryptoSpan[]): CryptoSpan[] {
  const merged: CryptoSpan[] = [];
  for (const span of spans) {
    const previous = merged.at(-1);
    if (
      previous &&
      previous.cipherId === span.cipherId &&
      previous.offset + previous.length === span.offset
    ) {
      previous.length += span.length;
    } else {
      merged.push({ ...span });
    }
  }
  return merged;
}

function readServerSpans(value: unknown): Span[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isSpan).map((span) => ({ ...span }));
}

function isSpan(value: unknown): value is Span {
  if (!value || typeof value !== 'object') return false;
  const span = value as Partial<Span>;
  return (
    typeof span.type === 'string' &&
    Number.isInteger(span.offset) &&
    Number.isInteger(span.length) &&
    (span.offset ?? -1) >= 0 &&
    (span.length ?? -1) >= 0
  );
}
