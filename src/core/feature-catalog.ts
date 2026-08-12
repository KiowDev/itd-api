import type { OperationCatalog } from './catalog.js';
import { ItdConfigError } from './errors.js';
import type { OperationDefinition } from './operation.js';
import type { RateLimitBucketOverride } from './options.js';

/** Описание операции, добавленной поверх базового каталога. @internal */
export interface RegisteredOperationDefinition extends OperationDefinition {
  readonly bucket: string;
}

/**
 * Изменяемый слой над каталогом конкретного API.
 *
 * Базовый каталог остаётся замороженным и общим для всех клиентов, а регистрации feature
 * принадлежат одному facade. Поэтому установка модуля в одном клиенте не меняет остальные.
 *
 * @internal
 */
export class ExtensibleOperationCatalog implements OperationCatalog {
  readonly #base: OperationCatalog;
  readonly #operations = new Map<string, RegisteredOperationDefinition>();
  readonly #operationOwners = new Map<string, string>();
  readonly #bucketOwners = new Map<string, string>();
  readonly #bucketLimits: Record<string, number>;
  readonly #bucketOverrides: Record<string, RateLimitBucketOverride>;

  constructor(base: OperationCatalog) {
    this.#base = base;
    this.#bucketLimits = { ...base.bucketLimits };
    this.#bucketOverrides = { ...base.bucketOverrides };
  }

  get bucketLimits(): Readonly<Record<string, number>> {
    return this.#bucketLimits;
  }

  get bucketOverrides(): Readonly<Record<string, RateLimitBucketOverride>> {
    return this.#bucketOverrides;
  }

  get defaultBucket(): string {
    return this.#base.defaultBucket;
  }

  retrySafetyOf(id: string) {
    return this.#operations.get(id)?.retrySafety ?? this.#base.retrySafetyOf(id);
  }

  methodOf(id: string) {
    return this.#operations.get(id)?.method ?? this.#base.methodOf(id);
  }

  bucketOf(id: string): string {
    return this.#operations.get(id)?.bucket ?? this.#base.bucketOf(id);
  }

  isKnownBucket(name: string): boolean {
    return this.#bucketOwners.has(name) || this.#base.isKnownBucket(name);
  }

  /** Регистрирует принадлежащий feature бакет и возвращает откат регистрации. */
  registerBucket(owner: string, name: string, definition: RateLimitBucketOverride): () => void {
    if (this.#base.isKnownBucket(name) || this.#bucketOwners.has(name)) {
      throw new ItdConfigError(`feature «${owner}»: бакет «${name}» уже зарегистрирован`);
    }

    this.#bucketOwners.set(name, owner);
    if (definition.limit !== undefined) this.#bucketLimits[name] = definition.limit;
    if (definition.concurrency !== undefined || definition.rps !== undefined) {
      this.#bucketOverrides[name] = Object.freeze({
        ...(definition.concurrency === undefined ? {} : { concurrency: definition.concurrency }),
        ...(definition.rps === undefined ? {} : { rps: definition.rps }),
      });
    }

    return () => {
      if (this.#bucketOwners.get(name) !== owner) return;
      this.#bucketOwners.delete(name);
      delete this.#bucketLimits[name];
      delete this.#bucketOverrides[name];
    };
  }

  /** Регистрирует операцию и возвращает откат регистрации. */
  registerOperation(
    owner: string,
    id: string,
    definition: RegisteredOperationDefinition,
  ): () => void {
    const ownerPrefix = `${owner}.`;
    if (!id.startsWith(ownerPrefix) || id.length === ownerPrefix.length) {
      throw new ItdConfigError(
        `feature «${owner}»: операция «${id}» должна находиться в пространстве имён «${owner}»`,
      );
    }

    const occupiedBy = this.#operationOwners.get(id);
    if (occupiedBy !== undefined) {
      throw new ItdConfigError(
        `feature «${owner}»: операция «${id}» уже зарегистрирована feature «${occupiedBy}»`,
      );
    }

    if (this.#base.methodOf(id) !== undefined) {
      throw new ItdConfigError(
        `feature «${owner}»: операция «${id}» уже существует в базовом каталоге`,
      );
    }

    this.#operationOwners.set(id, owner);
    this.#operations.set(id, Object.freeze({ ...definition }));

    return () => {
      if (this.#operationOwners.get(id) !== owner) return;
      this.#operationOwners.delete(id);
      this.#operations.delete(id);
    };
  }
}
