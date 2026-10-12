import type { ItdClient, Page, Paginator } from 'itd-api';
import type { HydratedNotificationEvents } from '../facades/events.types.js';
import type {
  FieldsShape,
  Hydrated,
  ListShape,
  ModelShape,
  PaginatorShape,
  ShapeBase,
} from '../shapes/shape.types.js';
import type { RESOURCE_RESULTS } from './results.constants.js';

type FieldsShapeOf<Value> = FieldsShape<{ readonly [K in keyof Value]?: ShapeBase }>;

type ShapeFor<Result> =
  Result extends Paginator<unknown>
    ? PaginatorShape
    : Awaited<Result> extends readonly unknown[]
      ? ListShape
      : Awaited<Result> extends Page<unknown>
        ? FieldsShapeOf<Awaited<Result>>
        : ModelShape | FieldsShapeOf<Awaited<Result>>;

/** Формы результатов методов объекта ресурсов; вложенные ресурсы описываются так же. */
export type ResourceResults<T> = {
  readonly [K in keyof T]?: T[K] extends (...args: never[]) => infer Result
    ? ShapeFor<Result>
    : ResourceResults<T[K]>;
};

/** Обработчик гидратированного результата, которому нужны аргументы вызова. */
export type ResultBinding = (result: object, args: readonly unknown[]) => void;

/** Обработчики результатов методов объекта ресурсов; вложенные ресурсы описываются так же. */
export type ResourceBindings<T> = {
  readonly [K in keyof T]?: T[K] extends (...args: never[]) => unknown
    ? ResultBinding
    : ResourceBindings<T[K]>;
};

type HydratedReturn<Result, S> =
  Result extends Promise<infer Value> ? Promise<Hydrated<Value, S>> : Hydrated<Result, S>;

type HydratedResource<Resource, Results> = {
  [K in keyof Resource]: K extends keyof Results
    ? Resource[K] extends (...args: infer Args) => infer Result
      ? (...args: Args) => HydratedReturn<Result, Results[K]>
      : HydratedResource<Resource[K], Results[K]>
    : Resource[K];
};

type ResultResource = keyof typeof RESOURCE_RESULTS;

/**
 * Вариант клиента, ресурсы которого возвращают модели с действиями.
 *
 * @example
 * ```ts
 * type AppClient = HydrateFlavor<ItdClient>;
 * ```
 */
export type HydrateFlavor<Client extends ItdClient = ItdClient> = Omit<Client, ResultResource> & {
  readonly [K in ResultResource]: K extends 'notifications'
    ? Omit<HydratedResource<Client[K], (typeof RESOURCE_RESULTS)[K]>, 'events'> & {
        readonly events: HydratedNotificationEvents;
      }
    : HydratedResource<Client[K], (typeof RESOURCE_RESULTS)[K]>;
};

/** Карта результатов в рантайме: форма метода либо карта вложенного ресурса. */
export type ResultMap = { readonly [key: string]: ShapeBase | ResultMap };

/** Карта обработчиков результатов в рантайме. */
export type BindingMap = { readonly [key: string]: ResultBinding | BindingMap };
