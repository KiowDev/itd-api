export type AnyRecord = Record<PropertyKey, unknown>;
export type ModelAction = (this: AnyRecord, ...args: unknown[]) => unknown;
