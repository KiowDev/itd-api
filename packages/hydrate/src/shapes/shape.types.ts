import type { Page, Paginator } from 'itd-api';
import type { ModelKind } from '../models/model.constants.js';
import type { ModelSchema } from '../models/model.types.js';
import type { ShapeKind } from './shape.constants.js';

/** Общая часть дескрипторов формы. */
export interface ShapeBase {
  readonly kind: ShapeKind;
}

/** Модель вида `K`. */
export interface ModelShape<K extends ModelKind = ModelKind> extends ShapeBase {
  readonly kind: typeof ShapeKind.Model;
  readonly model: K;
}

/** Массив элементов формы `I`. */
export interface ListShape<I extends ShapeBase = ShapeBase> extends ShapeBase {
  readonly kind: typeof ShapeKind.List;
  readonly item: I;
}

/** Пагинатор элементов формы `I`. */
export interface PaginatorShape<I extends ShapeBase = ShapeBase> extends ShapeBase {
  readonly kind: typeof ShapeKind.Paginator;
  readonly item: I;
}

/** Формы полей записи. */
export type FieldShapes = Readonly<Partial<Record<string, ShapeBase>>>;

/** Запись, в которой гидратируются только поля из `F`. */
export interface FieldsShape<F extends FieldShapes = FieldShapes> extends ShapeBase {
  readonly kind: typeof ShapeKind.Fields;
  readonly fields: F;
}

/** Запись `Raw`, у которой поля из `F` гидратированы, а остальные сохранили свой тип. */
export type HydratedFields<Raw, F> = {
  [K in keyof Raw]: K extends keyof F ? Hydrated<Raw[K], F[K]> : Raw[K];
};

type HydratedPage<Item, I extends ShapeBase> = HydratedFields<Page<Item>, { items: ListShape<I> }>;

type HydratedPaginator<Item, I extends ShapeBase> = Omit<
  Paginator<Item>,
  'next' | 'pages' | 'collect' | typeof Symbol.asyncIterator
> & {
  next(): Promise<HydratedPage<Item, I> | null>;
  pages(): AsyncGenerator<HydratedPage<Item, I>, void, undefined>;
  collect(max?: number): Promise<Hydrated<Item, I>[]>;
  [Symbol.asyncIterator](): AsyncGenerator<Hydrated<Item, I>, void, undefined>;
};

/** Значение `Raw` после гидратации по форме `S`. */
export type Hydrated<Raw, S> = Raw extends null | undefined
  ? Raw
  : S extends ModelShape<infer K>
    ? HydratedFields<Raw, ModelSchema<K>>
    : S extends ListShape<infer I>
      ? Raw extends readonly (infer Item)[]
        ? Hydrated<Item, I>[]
        : Raw
      : S extends PaginatorShape<infer I extends ShapeBase>
        ? Raw extends Paginator<infer Item>
          ? HydratedPaginator<Item, I>
          : Raw
        : S extends FieldsShape<infer F>
          ? HydratedFields<Raw, F>
          : Raw;
