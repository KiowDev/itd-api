import { ItdConfigError, ItdStateError } from './errors.js';

/** Долгоживущий ресурс, участвующий в lifecycle создавшего его клиента. */
export interface ManagedClientResource {
  /** Короткое имя для диагностики зависшего shutdown. */
  readonly kind: string;
  /** Синхронно прекращает принимать новую работу и запускает отмену. */
  stop(): void;
  /** Завершается после выхода активных обработчиков и cleanup внешних ресурсов. */
  drain(): Promise<void>;
}

export interface ManagedResourceSnapshot {
  readonly resources: readonly ManagedClientResource[];
  readonly errors: readonly unknown[];
}

/** Реестр активных ресурсов одного feature-host. @internal */
export class ManagedResourceRegistry {
  readonly #resources = new Set<ManagedClientResource>();
  #disposed = false;

  register(resource: ManagedClientResource): () => void {
    if (this.#disposed) throw new ItdStateError('Lifecycle клиента уже освобождён');
    if (
      typeof resource !== 'object' ||
      resource === null ||
      typeof resource.kind !== 'string' ||
      resource.kind.trim() === '' ||
      typeof resource.stop !== 'function' ||
      typeof resource.drain !== 'function'
    ) {
      throw new ItdConfigError('Managed resource должен предоставлять kind, stop() и drain()');
    }

    this.#resources.add(resource);
    let registered = true;
    return () => {
      if (!registered) return;
      registered = false;
      this.#resources.delete(resource);
    };
  }

  /** Останавливает snapshot синхронно, чтобы новые auth-данные ещё не были опубликованы. */
  stopAll(): ManagedResourceSnapshot {
    const resources = [...this.#resources];
    const errors: unknown[] = [];
    for (const resource of resources) {
      try {
        resource.stop();
      } catch (error) {
        errors.push(error);
      }
    }
    return { resources, errors };
  }

  dispose(): void {
    this.#disposed = true;
    this.#resources.clear();
  }
}
