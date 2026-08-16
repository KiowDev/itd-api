import type { OperationRequestOptions, Span } from 'itd-api';
import type { Cipher, CipherRef, CryptoRange, RawCryptoOptions } from './cipher.js';
import { CryptError } from './errors.js';
import type { TextFieldDefinition } from './fields.js';
import { cipherIdWidth, encodeFrame } from './protocol.js';
import type { CipherRegistry } from './registry.js';

const VISUAL_SPANS = new Set([
  'bold',
  'italic',
  'underline',
  'strike',
  'spoiler',
  'monospace',
  'quote',
]);
const SEMANTIC_SPANS = new Set(['link', 'mention', 'hashtag']);
const MAX_UNBOUNDED_HEADER = 1_000_000;

interface ResolvedRange {
  start: number;
  end: number;
  cipher: Cipher;
}

interface PlainReplacement extends ResolvedRange {
  wire: string;
}

interface PositionReplacement {
  plainStart: number;
  plainEnd: number;
  wireStart: number;
  wireEnd: number;
}

/** Возвращает исходный request, если в нём нет указаний на шифрование. */
export function prepareRequest(
  request: OperationRequestOptions,
  options: RawCryptoOptions,
  registry: CipherRegistry,
  fields: readonly TextFieldDefinition[] | undefined,
  cryptoConfigured = false,
): OperationRequestOptions {
  const body = asRecord(request.body);
  const hasBodyRanges = containsCryptoSpans(body, fields);
  const hasRawRanges = Object.hasOwn(options, 'spans');
  const hasWholeOption = Object.hasOwn(options, 'encrypt');
  const hasWhole = hasWholeOption && options.encrypt !== undefined;

  const operation = request.operationId;
  if (hasWholeOption && !hasWhole) {
    throw new CryptError(`Операция ${operation}: encrypt должен содержать имя или ID cipher`);
  }
  if (
    !hasBodyRanges &&
    !hasRawRanges &&
    !hasWhole &&
    cryptoConfigured &&
    !Object.hasOwn(options, 'decrypt')
  ) {
    throw new CryptError(`Операция ${operation}: укажите encrypt или spans`);
  }
  if (!hasBodyRanges && !hasRawRanges && !hasWhole) return request;
  if (!fields) throw new CryptError(`Операция ${operation} не принимает текстовые поля`);
  if (!body) throw new CryptError(`Операция ${operation}: отсутствует объект body`);
  validateFieldDefinitions(fields, operation);

  if (hasRawRanges && !Array.isArray(options.spans)) {
    throw new CryptError(`Операция ${operation}: extensions.crypto.spans должен быть массивом`);
  }
  if (hasRawRanges && options.spans?.length === 0) {
    throw new CryptError(`Операция ${operation}: extensions.crypto.spans не может быть пустым`);
  }
  if (hasWhole && (hasRawRanges || hasBodyRanges)) {
    throw new CryptError(`Операция ${operation}: encrypt нельзя передавать вместе с crypto spans`);
  }

  const ranges = hasWhole
    ? wholeFieldRanges(body, fields, options.encrypt as CipherRef, operation)
    : collectRanges(body, fields, options.spans ?? [], operation);

  if (ranges.size === 0) {
    throw new CryptError(`Операция ${operation}: не найдено непустых текстовых полей`);
  }

  const prepared: Record<string, unknown> = { ...body };
  for (const field of fields) {
    const requested = ranges.get(field.name);
    if (!requested) continue;

    const text = body[field.name];
    if (typeof text !== 'string') {
      throw new CryptError(`Операция ${operation}, поле ${field.name}: ожидалась строка`);
    }

    const allSpans = readSpans(body, field.spansField);
    // Нулевая разметка не описывает фрагмент и запрещена основным клиентом. Подключаемая
    // операция может обойти его валидатор, поэтому перед пересчётом такую разметку удаляем.
    // Crypto spans сохраняются здесь даже с нулевой длиной: resolveRanges обязан завершить
    // запрос ошибкой, иначе предназначенный для шифрования текст уйдёт открытым.
    const serverSpans = allSpans.filter((span) => span.type !== 'crypto' && span.length > 0);
    const resolved = resolveRanges(requested, text, field, serverSpans, registry, operation);
    const transformed = transformField(text, resolved, serverSpans, field, operation);

    prepared[field.name] = transformed.text;
    if (field.spansField && Array.isArray(body[field.spansField])) {
      prepared[field.spansField] = transformed.spans;
    }
  }

  return { ...request, body: prepared };
}

function wholeFieldRanges(
  body: Record<string, unknown>,
  fields: readonly TextFieldDefinition[],
  cipher: CipherRef,
  operation: string,
): Map<string, CryptoRange[]> {
  const result = new Map<string, CryptoRange[]>();
  for (const field of fields) {
    const value = body[field.name];
    if (value === undefined || value === '') continue;
    if (typeof value !== 'string') {
      throw new CryptError(`Операция ${operation}, поле ${field.name}: ожидалась строка`);
    }
    result.set(field.name, [{ field: field.name, cipher, offset: 0, length: value.length }]);
  }
  return result;
}

function collectRanges(
  body: Record<string, unknown>,
  fields: readonly TextFieldDefinition[],
  rawRanges: readonly CryptoRange[],
  operation: string,
): Map<string, CryptoRange[]> {
  const result = new Map<string, CryptoRange[]>();
  const known = new Set(fields.map((field) => field.name));

  for (const range of rawRanges) {
    if (!range || typeof range !== 'object') {
      throw new CryptError(`Операция ${operation}: crypto range должен быть объектом`);
    }
    if (range.cipher === undefined) {
      throw new CryptError(`Операция ${operation}: crypto range не содержит cipher`);
    }
    if (fields.length > 1 && range.field === undefined) {
      throw new CryptError(`Операция ${operation}: crypto range должен содержать field`);
    }
    const field = range.field ?? fields[0]?.name;
    if (!field || !known.has(field)) {
      throw new CryptError(`Операция ${operation}: текстовое поле «${String(field)}» не объявлено`);
    }
    append(result, field, { ...range, field });
  }

  for (const field of fields) {
    for (const span of readSpans(body, field.spansField)) {
      if (!isCryptoSpan(span)) continue;
      if (span.cipher === undefined) {
        throw new CryptError(`Операция ${operation}, поле ${field.name}: crypto span без cipher`);
      }
      append(result, field.name, {
        field: field.name,
        cipher: span.cipher,
        offset: span.offset,
        length: span.length,
      });
    }
  }

  return result;
}

function resolveRanges(
  ranges: readonly CryptoRange[],
  text: string,
  field: TextFieldDefinition,
  spans: readonly Span[],
  registry: CipherRegistry,
  operation: string,
): ResolvedRange[] {
  const resolved = ranges.map((range) => {
    const context = rangeContext(operation, field.name, range.offset, range.length, range.cipher);
    if (
      !Number.isInteger(range.offset) ||
      !Number.isInteger(range.length) ||
      range.offset < 0 ||
      range.length <= 0 ||
      range.offset + range.length > text.length
    ) {
      throw new CryptError(`${context}: диапазон должен быть непустым и лежать внутри поля`);
    }
    const cipher = registry.resolve(range.cipher, context);
    if (typeof cipher.encode !== 'function') {
      throw new CryptError(`${context}: cipher «${cipher.name}» доступен только для чтения`);
    }
    if (cipher.requiresInvisibleAlphabet && !field.preservesInvisibleAlphabet) {
      throw new CryptError(`${context}: поле не сохраняет невидимый алфавит`);
    }
    return { start: range.offset, end: range.offset + range.length, cipher };
  });

  resolved.sort((left, right) => left.start - right.start || left.end - right.end);
  for (let index = 1; index < resolved.length; index++) {
    const previous = resolved[index - 1];
    const current = resolved[index];
    if (previous && current && current.start < previous.end) {
      throw new CryptError(
        `${rangeContext(operation, field.name, current.start, current.end - current.start, current.cipher.name)}: ` +
          'crypto-диапазоны пересекаются',
      );
    }
  }

  for (const range of resolved) {
    for (const span of spans) {
      if (!SEMANTIC_SPANS.has(String(span.type)) || !overlaps(range, span)) continue;
      throw new CryptError(
        `${rangeContext(operation, field.name, range.start, range.end - range.start, range.cipher.name)}: ` +
          `пересекается с семантическим span «${span.type}»`,
      );
    }
  }

  return resolved;
}

function transformField(
  text: string,
  ranges: readonly ResolvedRange[],
  spans: readonly Span[],
  field: TextFieldDefinition,
  operation: string,
): { text: string; spans: Span[] } {
  const replacements: PlainReplacement[] = [];
  const bareWholeField =
    ranges.length === 1 &&
    ranges[0]?.start === 0 &&
    ranges[0]?.end === text.length &&
    !hasInternalVisualBoundary(spans, text.length);

  for (const range of ranges) {
    if (bareWholeField) {
      replacements.push({ ...range, wire: encode(range.cipher, text, operation, field.name) });
      continue;
    }

    if (!range.cipher.supportsFragments) {
      if (ranges.length !== 1 || range.start !== 0 || range.end !== text.length) {
        throw new CryptError(
          `${rangeContext(operation, field.name, range.start, range.end - range.start, range.cipher.name)}: ` +
            'cipher не поддерживает fragments',
        );
      }
      throw new CryptError(
        `${rangeContext(operation, field.name, range.start, range.end - range.start, range.cipher.name)}: ` +
          'whole-field cipher несовместим с внутренними границами visual spans',
      );
    }

    if (!field.preservesInvisibleAlphabet) {
      throw new CryptError(
        `${rangeContext(operation, field.name, range.start, range.end - range.start, range.cipher.name)}: ` +
          'fragment mode требует сохраняемый невидимый алфавит',
      );
    }
    const headerWidth = 8 + cipherIdWidth(range.cipher.id);
    if (
      (field.maxLength !== undefined && headerWidth > field.maxLength) ||
      (field.maxLength === undefined && headerWidth > MAX_UNBOUNDED_HEADER)
    ) {
      throw new CryptError(
        `${rangeContext(operation, field.name, range.start, range.end - range.start, range.cipher.name)}: ` +
          `заголовок cipher ID имеет длину ${headerWidth}`,
      );
    }

    const boundaries = visualBoundaries(spans, range.start, range.end);
    let start = range.start;
    for (const end of [...boundaries, range.end]) {
      const context = rangeContext(operation, field.name, start, end - start, range.cipher.name);
      const payload = encode(range.cipher, text.slice(start, end), operation, field.name);
      replacements.push({
        start,
        end,
        cipher: range.cipher,
        wire: encodeFrame(range.cipher, payload, context),
      });
      start = end;
    }
  }

  const output: string[] = [];
  const positions: PositionReplacement[] = [];
  let plainCursor = 0;
  let wireCursor = 0;
  for (const replacement of replacements) {
    const open = text.slice(plainCursor, replacement.start);
    output.push(open, replacement.wire);
    wireCursor += open.length;
    positions.push({
      plainStart: replacement.start,
      plainEnd: replacement.end,
      wireStart: wireCursor,
      wireEnd: wireCursor + replacement.wire.length,
    });
    wireCursor += replacement.wire.length;
    plainCursor = replacement.end;
  }
  output.push(text.slice(plainCursor));
  const wireText = output.join('');

  if (field.maxLength !== undefined && wireText.length > field.maxLength) {
    throw new CryptError(
      `Операция ${operation}, поле ${field.name}: длина после шифрования ${wireText.length}, лимит ${field.maxLength}`,
    );
  }

  return {
    text: wireText,
    spans: spans.map((span) => remapPlainSpan(span, positions)),
  };
}

function encode(cipher: Cipher, text: string, operation: string, field: string): string {
  try {
    const encoded = (cipher.encode as (text: string) => unknown)(text);
    if (typeof encoded !== 'string') {
      throw new CryptError(
        `Операция ${operation}, поле ${field}, cipher «${cipher.name}»: encode должен вернуть строку`,
      );
    }
    return encoded;
  } catch (error) {
    if (error instanceof CryptError) throw error;
    throw new CryptError(
      `Операция ${operation}, поле ${field}, cipher «${cipher.name}»: encode завершился ошибкой`,
      { cause: error },
    );
  }
}

function remapPlainSpan(span: Span, replacements: readonly PositionReplacement[]): Span {
  const start = mapPlainPosition(span.offset, 'start', replacements);
  const end = mapPlainPosition(span.offset + span.length, 'end', replacements);
  return { ...span, offset: start, length: end - start };
}

function mapPlainPosition(
  position: number,
  side: 'start' | 'end',
  replacements: readonly PositionReplacement[],
): number {
  let delta = 0;
  for (const replacement of replacements) {
    if (position < replacement.plainStart) break;
    if (position === replacement.plainStart) return replacement.wireStart;
    if (position < replacement.plainEnd) {
      return side === 'start' ? replacement.wireStart : replacement.wireEnd;
    }
    if (position === replacement.plainEnd) return replacement.wireEnd;
    delta +=
      replacement.wireEnd - replacement.wireStart - (replacement.plainEnd - replacement.plainStart);
  }
  return position + delta;
}

function visualBoundaries(spans: readonly Span[], start: number, end: number): number[] {
  const boundaries = new Set<number>();
  for (const span of spans) {
    if (!VISUAL_SPANS.has(String(span.type))) continue;
    const spanEnd = span.offset + span.length;
    if (span.offset > start && span.offset < end) boundaries.add(span.offset);
    if (spanEnd > start && spanEnd < end) boundaries.add(spanEnd);
  }
  return [...boundaries].sort((left, right) => left - right);
}

function hasInternalVisualBoundary(spans: readonly Span[], length: number): boolean {
  return spans.some((span) => {
    if (!VISUAL_SPANS.has(String(span.type))) return false;
    const end = span.offset + span.length;
    return (span.offset > 0 && span.offset < length) || (end > 0 && end < length);
  });
}

function overlaps(range: ResolvedRange, span: Span): boolean {
  return Math.max(range.start, span.offset) < Math.min(range.end, span.offset + span.length);
}

function readSpans(body: Record<string, unknown>, field: string | undefined): Span[] {
  if (!field || !Array.isArray(body[field])) return [];
  return body[field].filter(isSpanLike).map((span) => ({ ...span }));
}

function containsCryptoSpans(
  body: Record<string, unknown> | null,
  fields: readonly TextFieldDefinition[] | undefined,
): boolean {
  if (!body) return false;
  const spanFields = fields?.flatMap((field) => (field.spansField ? [field.spansField] : [])) ?? [
    'spans',
  ];
  return spanFields.some(
    (field) => Array.isArray(body[field]) && body[field].some((span) => isCryptoSpan(span)),
  );
}

function isSpanLike(value: unknown): value is Span & { cipher?: CipherRef | undefined } {
  if (!value || typeof value !== 'object') return false;
  const span = value as Partial<Span>;
  return (
    typeof span.type === 'string' &&
    typeof span.offset === 'number' &&
    typeof span.length === 'number'
  );
}

function isCryptoSpan(value: unknown): value is Span & { cipher?: CipherRef | undefined } {
  return isSpanLike(value) && value.type === 'crypto';
}

function append(map: Map<string, CryptoRange[]>, field: string, range: CryptoRange): void {
  const current = map.get(field);
  if (current) current.push(range);
  else map.set(field, [range]);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function validateFieldDefinitions(fields: readonly TextFieldDefinition[], operation: string): void {
  const names = new Set<string>();
  for (const field of fields) {
    if (typeof field.name !== 'string' || field.name === '' || names.has(field.name)) {
      throw new CryptError(`Операция ${operation}: некорректные metadata текстовых полей`);
    }
    if (
      field.maxLength !== undefined &&
      (!Number.isSafeInteger(field.maxLength) || field.maxLength <= 0)
    ) {
      throw new CryptError(`Операция ${operation}, поле ${field.name}: некорректный maxLength`);
    }
    names.add(field.name);
  }
}

function rangeContext(
  operation: string,
  field: string,
  offset: number,
  length: number,
  cipher: CipherRef,
): string {
  return `Операция ${operation}, поле ${field}, диапазон [${offset}, ${offset + length}), cipher «${String(cipher)}»`;
}
