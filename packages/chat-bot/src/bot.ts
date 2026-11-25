import { type ChatEvents, type ItdClient, ItdConfigError } from 'itd-api';
import type { ChatBotErrorHandler, ChatBotOptions } from './bot.types.js';
import { ChatContext } from './context/context.js';
import type { ChatBotClient } from './context/context.types.js';
import { commandPrefixMiddleware } from './middleware/commands.js';
import { ChatComposer } from './middleware/composer.js';
import type { ChatBotFilter } from './middleware/filters.enum.js';
import type { ChatFilterContext } from './middleware/filters.types.js';
import type { ChatMiddlewareLike } from './middleware/middleware.js';
import { ChatUpdateDispatcher } from './runtime/dispatch.js';
import type { ChatBotLifecycleEvent } from './runtime/lifecycle.enum.js';
import { isLifecycleEvent, type LifecycleHandler } from './runtime/lifecycle.js';
import type { ChatBotLifecycleEvents } from './runtime/lifecycle.types.js';
import { ChatBotRuntime } from './runtime/runtime.js';

/**
 * Команды и цепочка обработчиков поверх событий чатов полного клиента.
 *
 * @example
 * ```ts
 * const bot = new ChatBot(itd);
 * bot.command('start', (ctx) => ctx.reply('Привет!'));
 * await bot.start();
 * ```
 */
export class ChatBot<
  Client extends ChatBotClient = ItdClient,
  C extends ChatContext<Client> = ChatContext<Client>,
> extends ChatComposer<C> {
  /** Клиент бота. Доступен в обработчиках как `ctx.itd`. */
  readonly itd: Client;
  readonly #runtime: ChatBotRuntime;
  readonly #dispatcher: ChatUpdateDispatcher<Client, C>;

  /**
   * Создаёт бота поверх клиента с каналом чатов.
   *
   * @param itd клиент чатов, доступный в обработчиках как `ctx.itd`.
   * @param options настройки бота. Для своего класса контекста передайте `createContext`.
   */
  constructor(
    itd: Client,
    ...[options]: ChatContext<Client> extends C
      ? [options?: ChatBotOptions<Client, C>]
      : [options: ChatBotOptions<Client, C>]
  ) {
    if (typeof itd?.chats?.events?.connect !== 'function') {
      throw new ItdConfigError('ChatBot требует ItdClient с поддержкой chats.events');
    }
    const concurrency = options?.concurrency ?? 1;
    if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
      throw new ItdConfigError('ChatBot.concurrency должен быть положительным целым числом');
    }
    const maxPendingUpdates = options?.maxPendingUpdates ?? 256;
    if (!Number.isSafeInteger(maxPendingUpdates) || maxPendingUpdates < 1) {
      throw new ItdConfigError('ChatBot.maxPendingUpdates должен быть положительным целым числом');
    }
    super();
    super.use(commandPrefixMiddleware(options?.commandPrefixes));
    this.itd = itd;
    // Без фабрики сигнатура конструктора допускает базовый ChatContext.
    const createContext =
      options?.createContext?.bind(this) ??
      ((...args: ConstructorParameters<typeof ChatContext<Client>>) =>
        new ChatContext(...args) as C);
    this.#dispatcher = new ChatUpdateDispatcher(itd, createContext, (context, next) =>
      this.middleware()(context, next),
    );
    this.#runtime = new ChatBotRuntime(
      this,
      { concurrency, maxPendingUpdates, checkpoint: options?.checkpoint },
      (update, signal, logger) => this.#dispatcher.dispatch(update, signal, logger),
    );
  }

  /** Канал событий, который бот использует для получения обновлений. */
  get stream(): ChatEvents {
    return this.itd.chats.events;
  }

  /** Бот запущен, включая подготовку, подключение и повторные попытки. */
  get isRunning(): boolean {
    return this.#runtime.isRunning;
  }

  /** У активного бота открыт WebSocket. Догрузка пропущенных событий может ещё выполняться. */
  get isReady(): boolean {
    return this.#runtime.isReady;
  }

  /** Добавляет обработчики жизненного цикла. Они выполняются вне очереди сообщений. */
  override on<E extends ChatBotLifecycleEvent>(
    event: E,
    ...handlers: readonly ((payload: ChatBotLifecycleEvents[E]) => unknown)[]
  ): this;
  /**
   * Создаёт ветку для события чата или фильтра по сообщению.
   * Ветка срабатывает при совпадении хотя бы с одним фильтром.
   */
  override on<F extends ChatBotFilter>(
    query: F | readonly F[],
    ...middleware: readonly ChatMiddlewareLike<ChatFilterContext<C, F>>[]
  ): ChatComposer<ChatFilterContext<C, F>>;
  override on(
    query: ChatBotFilter | readonly ChatBotFilter[] | ChatBotLifecycleEvent,
    ...handlers: readonly (ChatMiddlewareLike<C> | LifecycleHandler)[]
  ): this | ChatComposer<ChatFilterContext<C, ChatBotFilter>> {
    if (isLifecycleEvent(query)) {
      this.#runtime.lifecycle.on(query, handlers as readonly LifecycleHandler[]);
      return this;
    }
    return super.on(
      query,
      ...(handlers as readonly ChatMiddlewareLike<ChatFilterContext<C, ChatBotFilter>>[]),
    );
  }

  /** Устанавливает общий обработчик ошибок команд и middleware. Получает исходную ошибку и её контекст. */
  catch(handler: ChatBotErrorHandler<C>): this {
    this.#dispatcher.errorHandler = handler.bind(this);
    return this;
  }

  /**
   * Подписывается на события и подключает канал. Если задан номер события, догружает пропущенные события.
   * Повторный вызов во время запуска возвращает тот же Promise.
   *
   * @param since номер последнего события. Имеет приоритет над сохранённым номером.
   * @throws {ItdStateError} если соединение уже открыто и задан номер события
   * или предыдущий запуск ещё завершает обработку.
   */
  start(since?: number): Promise<void> {
    return this.#runtime.start(since);
  }

  /** Прекращает приём событий и отменяет запросы текущего запуска. Можно вызвать внутри обработчика. */
  stop(): void {
    this.#runtime.stop();
  }

  /** После `stop()` ждёт обработчики, канал и запись номера события. Вызывайте вне цепочки бота. */
  drain(): Promise<void> {
    return this.#runtime.drain();
  }
}
