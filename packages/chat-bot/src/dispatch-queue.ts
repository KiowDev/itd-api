import type { ChatUpdate } from 'itd-api';

interface PendingUpdate {
  readonly update: ChatUpdate;
  readonly signal: AbortSignal;
  readonly complete: ((handled: boolean) => void) | undefined;
}

export class ChatDispatchQueue {
  readonly #concurrency: number;
  readonly #maxPendingUpdates: number;
  readonly #dispatch: (update: ChatUpdate, signal: AbortSignal) => Promise<boolean>;
  readonly #onError: (error: unknown) => void;
  readonly #pending: PendingUpdate[] = [];
  readonly #activeChats = new Set<ChatUpdate['chatId']>();
  readonly #drainWaiters = new Set<() => void>();

  constructor(
    concurrency: number,
    maxPendingUpdates: number,
    dispatch: (update: ChatUpdate, signal: AbortSignal) => Promise<boolean>,
    onError: (error: unknown) => void,
  ) {
    this.#concurrency = concurrency;
    this.#maxPendingUpdates = maxPendingUpdates;
    this.#dispatch = dispatch;
    this.#onError = onError;
  }

  enqueue(
    update: ChatUpdate,
    signal: AbortSignal,
    track?: () => ((handled: boolean) => void) | undefined,
  ): boolean {
    if (this.#pending.length >= this.#maxPendingUpdates) return false;
    this.#pending.push({ update, signal, complete: track?.() });
    this.#pump();
    return true;
  }

  clear(): void {
    this.#pending.length = 0;
  }

  drain(): Promise<void> {
    if (this.#activeChats.size === 0) return Promise.resolve();
    return new Promise((resolve) => this.#drainWaiters.add(resolve));
  }

  #pump(): void {
    while (this.#activeChats.size < this.#concurrency) {
      const index = this.#pending.findIndex(({ update }) => !this.#activeChats.has(update.chatId));
      if (index === -1) break;
      const [work] = this.#pending.splice(index, 1);
      if (!work) break;

      this.#activeChats.add(work.update.chatId);
      void this.#run(work);
    }
  }

  async #run({ update, signal, complete }: PendingUpdate): Promise<void> {
    let handled = false;
    try {
      // Обработчик может остановить бота. Выходим из стека публикации события SDK.
      await Promise.resolve();
      if (!signal.aborted) handled = await this.#dispatch(update, signal);
    } catch (error) {
      this.#onError(error);
    } finally {
      complete?.(handled);
      this.#activeChats.delete(update.chatId);
      this.#pump();
      if (this.#activeChats.size === 0) {
        for (const resolve of this.#drainWaiters) resolve();
        this.#drainWaiters.clear();
      }
    }
  }
}
