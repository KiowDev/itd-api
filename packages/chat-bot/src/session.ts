import {
  createKeyValueStore,
  ItdConfigError,
  type KeyValueStore,
  MemoryKeyValueStore,
} from 'itd-api';
import type { ChatContext } from './context.js';
import type { ChatMiddleware } from './middleware.js';

/** Дополнение контекста данными диалога. */
export interface SessionFlavor<S> {
  get session(): S | undefined;
  set session(value: S | null | undefined);
}

/** Настройки session middleware. */
export interface SessionOptions<S, C extends ChatContext = ChatContext> {
  /** Создаёт состояние при первом обращении к ключу. */
  initial?: (() => S) | undefined;
  /** Хранилище состояния. По умолчанию используется память процесса. */
  storage?: KeyValueStore<S> | undefined;
  /** Префикс записей в общем хранилище. */
  prefix?: string | undefined;
  /** Вычисляет ключ по контексту. По умолчанию используется ID чата. */
  getSessionKey?: ((context: C) => string | undefined | Promise<string | undefined>) | undefined;
}

function missingSession(context: ChatContext): void {
  Object.defineProperty(context, 'session', {
    configurable: true,
    get() {
      throw new Error('Для этого события невозможно определить ключ сессии');
    },
    set() {
      throw new Error('Для этого события невозможно определить ключ сессии');
    },
  });
}

/**
 * Загружает и сохраняет сессию поверх общего `KeyValueStore` ядра.
 *
 * Обработчики с одинаковым ключом выполняются последовательно.
 */
export function session<S, C extends ChatContext = ChatContext>(
  options: SessionOptions<S, C> = {},
): ChatMiddleware<C & SessionFlavor<S>> {
  if (options.initial !== undefined && typeof options.initial !== 'function') {
    throw new ItdConfigError('session.initial должен быть функцией');
  }
  if (options.getSessionKey !== undefined && typeof options.getSessionKey !== 'function') {
    throw new ItdConfigError('session.getSessionKey должен быть функцией');
  }
  const prefix = options.prefix ?? 'chat-bot:';
  if (typeof prefix !== 'string') throw new ItdConfigError('session.prefix должен быть строкой');

  const storage = createKeyValueStore(options.storage ?? new MemoryKeyValueStore<S>());
  const getSessionKey = options.getSessionKey ?? ((context: C) => context.chatId);
  const locks = new Map<string, Promise<void>>();

  return async (context, next) => {
    const rawKey = await getSessionKey(context);
    if (rawKey === undefined) {
      missingSession(context);
      await next();
      return;
    }
    if (typeof rawKey !== 'string' || rawKey.length === 0) {
      throw new ItdConfigError('Ключ сессии должен быть непустой строкой или undefined');
    }
    const key = `${prefix}${rawKey}`;
    const previous = locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    locks.set(key, current);
    await previous;

    try {
      let value: S | undefined = (await storage.get(key)) ?? undefined;
      let used = false;
      Object.defineProperty(context, 'session', {
        configurable: true,
        get: () => {
          if (!used && value === undefined) value = options.initial?.();
          used = true;
          return value;
        },
        set: (nextValue: S | null | undefined) => {
          used = true;
          value = nextValue ?? undefined;
        },
      });

      await next();
      if (!used) return;
      if (value === undefined) await storage.delete(key);
      else await storage.set(key, value);
    } finally {
      release();
      if (locks.get(key) === current) locks.delete(key);
    }
  };
}
