import { createKeyValueStore, ItdConfigError, type KeyValueStore } from 'itd-api';

/** Настройки сохранения номера последнего обработанного события. */
export interface ChatCheckpointOptions {
  /** Хранилище номера события. */
  storage: KeyValueStore<number>;
  /** Ключ в хранилище. Используйте свой ключ для каждой пары «бот и аккаунт». */
  key: string;
}

interface PendingPosition {
  through: number;
}

/** Сохраняет номер события, когда оно и все предыдущие успешно обработаны. */
export class ChatCheckpoint {
  readonly #storage: KeyValueStore<number>;
  readonly #key: string;
  readonly #onError: (error: unknown) => void;
  readonly #pending: PendingPosition[] = [];
  #blocked = false;
  #ready: number | undefined;
  #writing: Promise<void> | undefined;

  constructor(options: ChatCheckpointOptions, onError: (error: unknown) => void) {
    if (!options || typeof options.key !== 'string' || options.key.length === 0) {
      throw new ItdConfigError('ChatBot.checkpoint.key должен быть непустой строкой');
    }
    this.#storage = createKeyValueStore(options.storage);
    this.#key = options.key;
    this.#onError = onError;
  }

  /** Читает сохранённый номер после завершения записей предыдущего запуска. */
  async load(): Promise<number | undefined> {
    await this.drain();
    return this.#storage.get(this.#key);
  }

  /** Регистрирует событие до начала обработки и отмечает её результат. */
  track(position: number): ((handled: boolean) => void) | undefined {
    if (this.#blocked) return undefined;
    const entry = { through: position };
    this.#pending.push(entry);
    return (handled) => {
      const index = this.#pending.indexOf(entry);
      if (index < 0) return;
      if (!handled) {
        this.#blocked = true;
        this.#pending.length = index + 1;
        return;
      }
      this.#pending.splice(index, 1);
      // Сохраним и этот номер, когда завершится обработка предыдущего события.
      const previous = this.#pending[index - 1];
      if (previous) previous.through = entry.through;
      else this.#save(entry.through);
    };
  }

  /** Удаляет из памяти события, обработку которых прервала остановка бота. */
  reset(): void {
    this.#pending.length = 0;
    this.#blocked = false;
  }

  /** Ждёт завершения записи в хранилище. */
  async drain(): Promise<void> {
    await this.#writing;
  }

  #save(position: number): void {
    this.#ready = position;
    this.#writing ??= this.#flush();
  }

  /** Если за время записи обработано несколько событий, сохраняет последний номер. */
  async #flush(): Promise<void> {
    await Promise.resolve();
    try {
      while (this.#ready !== undefined) {
        const position = this.#ready;
        this.#ready = undefined;
        try {
          await this.#storage.set(this.#key, position);
        } catch (error) {
          this.#onError(error);
        }
      }
    } finally {
      this.#writing = undefined;
    }
  }
}
