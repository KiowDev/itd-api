import type { AccountFeature } from 'itd-api';
import {
  EventChannel,
  type EventContext,
  type EventTransport,
  type EventTransportFrame,
} from 'itd-api/events';
import {
  type ClientFeature,
  type FeatureContext,
  type FileInput,
  FileTransferMode,
  RetrySafety,
  type Unsubscribe,
} from 'itd-api/rest';

const CONTRACT_SERVICE = 'contract-probe-api';

const ContractOperation = Object.freeze({
  Read: 'read',
  Upload: 'upload',
} as const);

export const ContractEventOrigin = Object.freeze({
  Stream: 'stream',
} as const);
export type ContractEventOrigin = (typeof ContractEventOrigin)[keyof typeof ContractEventOrigin];

export interface ContractEvent {
  readonly id: string;
  readonly value: unknown;
}

export interface ContractEventContext
  extends EventContext<ContractEvent, ContractEvents, ContractEventOrigin> {}

export interface ContractEvents {
  connect(): Promise<void>;
  disconnect(): void;
  onEvent(listener: (event: ContractEvent) => void | Promise<void>): Unsubscribe;
}

export interface ContractProbeApi {
  readonly events: ContractEvents;
  serviceBaseUrl(): string;
  read(id: string): Promise<{ readonly id: string }>;
  upload(file: FileInput): Promise<{ readonly uploaded: boolean }>;
}

export interface ContractProbeFeatureOptions {
  readonly transport: EventTransport;
}

/**
 * Долгоживущая часть проверочного модуля. Класс владеет общим событийным каналом, а
 * клиент управляет его остановкой через публичный интерфейс жизненного цикла модуля.
 */
class ManagedContractEvents implements ContractEvents {
  readonly #context: FeatureContext;
  readonly #channel: EventChannel<ContractEvent, ContractEventContext>;
  #lifecycleActive = false;
  #lifecycleGeneration = 0;
  #unregister: (() => void) | undefined;

  constructor(context: FeatureContext, transport: EventTransport) {
    this.#context = context;
    this.#channel = new EventChannel<ContractEvent, ContractEventContext>(
      {
        connection: context.connection(CONTRACT_SERVICE),
        transport,
        streamOrigin: ContractEventOrigin.Stream,
        readUpdate: readContractEvent,
        createContext: (update, raw) => ({
          update,
          stream: this,
          raw,
          origin: ContractEventOrigin.Stream,
        }),
        deliver: () => undefined,
        connectGuard: () => context.assertActive('подключить события contract-probe'),
      },
      { maxAttempts: 0 },
    );
    this.#channel.on('giveup', () => this.#closeLifecycle());
  }

  async connect(): Promise<void> {
    if (!this.#lifecycleActive) {
      this.#lifecycleGeneration += 1;
      this.#unregister ??= this.#context.manage({
        kind: 'contract-probe events',
        stop: () => this.disconnect(),
        drain: () => this.#channel.drain(),
      });
      this.#lifecycleActive = true;
    }
    try {
      await this.#channel.connect();
    } catch (error) {
      this.#closeLifecycle();
      throw error;
    }
  }

  disconnect(): void {
    this.#channel.disconnect();
    this.#closeLifecycle();
  }

  onEvent(listener: (event: ContractEvent) => void | Promise<void>): Unsubscribe {
    return this.#channel.onUpdate(
      () => true,
      ({ update }) => listener(update),
    );
  }

  async dispose(): Promise<void> {
    this.disconnect();
    await this.#channel.drain();
    this.#unregister?.();
    this.#unregister = undefined;
    this.#channel.removeAllListeners();
  }

  #closeLifecycle(): void {
    if (!this.#lifecycleActive) return;
    this.#lifecycleActive = false;
    const generation = ++this.#lifecycleGeneration;
    void this.#channel.drain().then(() => {
      if (this.#lifecycleActive || generation !== this.#lifecycleGeneration) return;
      this.#unregister?.();
      this.#unregister = undefined;
    });
  }
}

function readContractEvent(frame: EventTransportFrame): ContractEvent | undefined {
  if (frame.name !== 'contract' || typeof frame.data !== 'object' || frame.data === null) {
    return undefined;
  }
  const data = frame.data as { id?: unknown; value?: unknown };
  if (typeof data.id !== 'string') return undefined;
  return { id: data.id, value: data.value };
}

/**
 * Небольшой модуль-потребитель публичного API. Он намеренно находится в тестах: его
 * задача — не поставлять новую возможность, а не позволить скрытым зависимостям проникнуть
 * в будущие отдельные точки входа.
 */
export function createContractProbeFeature(
  options: ContractProbeFeatureOptions,
): ClientFeature<ContractProbeApi> {
  return {
    name: 'contract-probe',
    services: [
      {
        name: CONTRACT_SERVICE,
        baseUrl: 'https://contract-probe.example',
        auth: true,
        headers: { 'X-Contract-Feature': 'enabled' },
      },
    ],
    buckets: {
      requests: { limit: 120, concurrency: 2, rps: 2 },
    },
    operations: {
      [ContractOperation.Read]: {
        method: 'GET',
        retrySafety: RetrySafety.Safe,
        service: CONTRACT_SERVICE,
        bucket: 'requests',
      },
      [ContractOperation.Upload]: {
        method: 'POST',
        retrySafety: RetrySafety.Idempotent,
        service: CONTRACT_SERVICE,
        bucket: 'requests',
      },
    },
    setup(context) {
      const events = new ManagedContractEvents(context, options.transport);
      return {
        api: Object.freeze({
          events,
          serviceBaseUrl: () => context.serviceBaseUrl(CONTRACT_SERVICE),
          read: (id: string) =>
            context.request<{ readonly id: string }>(ContractOperation.Read, {
              path: `/records/${encodeURIComponent(id)}`,
            }),
          upload: async (file: FileInput) => {
            const source = await context.files.resolve(
              file,
              { requireKnownSize: true },
              { signal: context.signal },
            );
            try {
              const body =
                source.mode === FileTransferMode.Buffer
                  ? new Uint8Array(await source.blob.arrayBuffer())
                  : source.stream;
              return await context.request<{ readonly uploaded: boolean }>(
                ContractOperation.Upload,
                {
                  path: '/uploads',
                  body,
                  ...(source.contentType
                    ? { headers: { 'Content-Type': source.contentType } }
                    : {}),
                },
              );
            } finally {
              if (source.mode === FileTransferMode.Stream) await source.close();
            }
          },
        }),
        dispose: () => events.dispose(),
      };
    },
  };
}

/** Создаёт независимое описание модуля и транспорт для каждого клиента контейнера аккаунтов. */
export function createContractProbeAccountFeature(
  createOptions: () => ContractProbeFeatureOptions,
): AccountFeature<ContractProbeApi> {
  return {
    key: 'contractProbe',
    create: () => createContractProbeFeature(createOptions()),
  };
}
