import type { Page, Paginator } from 'itd-api';
import type { ModelKind } from '../models/model.constants.js';
import type {
  FieldsShape,
  ListShape,
  ModelShape,
  PaginatorShape,
  ShapeBase,
} from '../shapes/shape.types.js';

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

/** Привязка модели из результата к аргументам вызова. */
export type ResultBinding = (model: object, args: readonly unknown[], kind: ModelKind) => void;

/** Обработчики результатов методов объекта ресурсов; вложенные ресурсы описываются так же. */
export type ResourceBindings<T> = {
  readonly [K in keyof T]?: T[K] extends (...args: never[]) => unknown
    ? ResultBinding
    : ResourceBindings<T[K]>;
};

/** Карта результатов в рантайме: форма метода либо карта вложенного ресурса. */
export type ResultMap = { readonly [key: string]: ShapeBase | ResultMap };

/** Карта обработчиков результатов в рантайме. */
export type BindingMap = { readonly [key: string]: ResultBinding | BindingMap };
