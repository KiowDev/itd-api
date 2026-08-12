/** Виды политики кэша, объявляемой в метаданных операции. */
export const CachePolicyKind = Object.freeze({
  Query: 'query',
  Mutation: 'mutation',
} as const);
export type CachePolicyKind = (typeof CachePolicyKind)[keyof typeof CachePolicyKind];

/** Области изоляции данных кэша. */
export const CachePolicyScope = Object.freeze({
  Account: 'account',
  Session: 'session',
} as const);
export type CachePolicyScope = (typeof CachePolicyScope)[keyof typeof CachePolicyScope];

/** Способы инвалидации кэша после мутации. */
export const CacheInvalidation = Object.freeze({
  All: 'all',
} as const);
export type CacheInvalidation = (typeof CacheInvalidation)[keyof typeof CacheInvalidation];
