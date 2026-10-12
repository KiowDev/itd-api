import type { AnyRecord } from './records.types.js';

export function isObject(value: unknown): value is object {
  return (typeof value === 'object' && value !== null) || typeof value === 'function';
}

export function isRecord(value: unknown): value is AnyRecord {
  if (typeof value !== 'object' || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function dataField(value: AnyRecord, key: PropertyKey): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}

export function stringProperty(target: AnyRecord, key: PropertyKey, label: string): string {
  const value = Reflect.get(target, key, target) as unknown;
  if (typeof value !== 'string' || value === '') {
    throw new TypeError(`У гидратированной модели отсутствует ${label}`);
  }
  return value;
}

export function modelId(target: AnyRecord): string {
  return stringProperty(target, 'id', 'идентификатор');
}
