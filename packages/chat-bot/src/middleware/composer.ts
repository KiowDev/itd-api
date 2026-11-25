import {
  EventComposer,
  type EventErrorBoundary,
  type EventFilter,
  type EventMiddleware,
  type EventMiddlewareLike,
  EventRouter,
  type EventRouteSelector,
  type EventTypeGuard,
  ItdConfigError,
} from 'itd-api';
import { type ChatContext, failedChatContexts } from '../context/context.js';
import {
  type ChatCommandContext,
  type ChatHearsContext,
  commandPredicate,
  type HearsTrigger,
  hearsPredicate,
} from './commands.js';
import type { ChatRouter } from './composer.types.js';
import type { ChatBotFilter } from './filters.enum.js';
import { matchesChatFilter } from './filters.js';
import type { ChatFilterContext } from './filters.types.js';
import { adaptMiddleware, type ChatMiddlewareLike, type ChatMiddlewareObj } from './middleware.js';

function toEventMiddleware<C extends ChatContext>(
  middleware: ChatMiddlewareLike<C>,
): EventMiddlewareLike<C> {
  return middleware instanceof ChatComposer ? middleware : adaptMiddleware(middleware);
}

/** Собирает цепочку обработчиков, которую можно подключить через `bot.use()`. */
export class ChatComposer<C extends ChatContext = ChatContext> implements ChatMiddlewareObj<C> {
  #composer: EventComposer<C> | undefined;

  get #chain(): EventComposer<C> {
    this.#composer ??= new EventComposer<C>();
    return this.#composer;
  }

  #child<N extends C>(composer: EventComposer<N>): ChatComposer<N> {
    const child = new ChatComposer<N>();
    child.#composer = composer;
    return child;
  }

  /** Добавляет обработчики по порядку. `await next()` передаёт управление дальше. */
  use(...middleware: readonly ChatMiddlewareLike<C>[]): this {
    this.#chain.use(...middleware.map(toEventMiddleware));
    return this;
  }

  /** Создаёт ветку для контекстов, прошедших проверку типа. */
  filter<N extends C>(
    predicate: EventTypeGuard<N, C>,
    ...middleware: readonly ChatMiddlewareLike<N>[]
  ): ChatComposer<N>;
  /** Создаёт ветку по синхронному или асинхронному условию. */
  filter(
    predicate: EventFilter<C>,
    ...middleware: readonly ChatMiddlewareLike<C>[]
  ): ChatComposer<C>;
  filter<N extends C>(
    predicate: EventFilter<C>,
    ...middleware: readonly ChatMiddlewareLike<N>[]
  ): ChatComposer<N> {
    return this.#child(
      this.#chain.filter(predicate as EventTypeGuard<N, C>, ...middleware.map(toEventMiddleware)),
    );
  }

  /** Создаёт ветку, которая срабатывает при совпадении хотя бы с одним фильтром. */
  on<F extends ChatBotFilter>(
    query: F | readonly F[],
    ...middleware: readonly ChatMiddlewareLike<ChatFilterContext<C, F>>[]
  ): ChatComposer<ChatFilterContext<C, F>> {
    const filters = typeof query === 'string' ? [query] : [...query];
    if (!filters.length) throw new ItdConfigError('Укажите хотя бы один фильтр для on()');
    return this.filter(
      (context): context is ChatFilterContext<C, F> => matchesChatFilter(context, filters),
      ...middleware,
    );
  }

  /**
   * Создаёт ветку для входящей команды. Аргументы доступны в `ctx.args`.
   *
   * @param command имя без префикса или список имён. Регистр букв не учитывается.
   */
  command(
    command: string | readonly string[],
    ...middleware: readonly ChatMiddlewareLike<ChatCommandContext<C>>[]
  ): ChatComposer<ChatCommandContext<C>> {
    return this.filter(commandPredicate<C>(command), ...middleware);
  }

  /**
   * Создаёт ветку для совпадения с текстом сообщения. Первое совпадение доступно в `ctx.match`.
   *
   * @param trigger строка для сравнения со всем текстом, регулярное выражение или список условий.
   */
  hears(
    trigger: HearsTrigger,
    ...middleware: readonly ChatMiddlewareLike<ChatHearsContext<C>>[]
  ): ChatComposer<ChatHearsContext<C>> {
    return this.filter(hearsPredicate<C>(trigger), ...middleware);
  }

  /** Добавляет именованные ветки. Селектор выбирает ключ события или возвращает `undefined`. */
  router<K extends PropertyKey>(selector: EventRouteSelector<K, C>): ChatRouter<K, C> {
    const router = new EventRouter<K, C>(selector);
    this.#chain.use(router);
    return {
      route: (key) => {
        const child = this.#child(new EventComposer<C>());
        router.route(key, child.middleware());
        return child;
      },
      otherwise: () => {
        const child = this.#child(new EventComposer<C>());
        router.otherwise(child.middleware());
        return child;
      },
    };
  }

  /** Выполняет одну ветку по условию. При ложном условии без запасной ветки продолжает цепочку. */
  branch(
    predicate: EventFilter<C>,
    matched: ChatMiddlewareLike<C>,
    fallback?: ChatMiddlewareLike<C>,
  ): this {
    if (typeof predicate !== 'function') {
      throw new ItdConfigError('branch() принимает функцию условия');
    }
    this.#chain.route(
      async (context) => ((await predicate(context)) ? 'matched' : undefined),
      { matched: toEventMiddleware(matched) },
      fallback === undefined ? undefined : toEventMiddleware(fallback),
    );
    return this;
  }

  /**
   * Создаёт ветку со своим обработчиком ошибок. Вызов `next()` в нём продолжает внешнюю цепочку.
   * При включённом `checkpoint` ошибка ветки не продвигает сохранённый номер события.
   */
  errorBoundary(
    handler: EventErrorBoundary<C>,
    ...middleware: readonly ChatMiddlewareLike<C>[]
  ): ChatComposer<C> {
    if (typeof handler !== 'function') {
      throw new ItdConfigError('errorBoundary() принимает обработчик ошибки');
    }
    return this.#child(
      this.#chain.errorBoundary(
        (failure, next) => {
          failedChatContexts.add(failure.context);
          return handler(failure, next);
        },
        ...middleware.map(toEventMiddleware),
      ),
    );
  }

  /** Возвращает обработчик для подключения цепочки к боту или другой цепочке. */
  middleware(): EventMiddleware<C> {
    return this.#chain.middleware();
  }
}
