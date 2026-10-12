import type { Page, Paginator } from 'itd-api';
import type { ModelKind } from '../models/model.constants.js';
import type { HydratedModel } from '../models/model.types.js';
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

/** Любой дескриптор формы. */
export type Shape = ModelShape | ListShape | PaginatorShape | FieldsShape;

/** Запись `Raw` без ключей `Without`, у которой поля из `F` гидратированы, а остальные сохранены. */
export type HydratedFields<Raw, F, Without = never> = {
  [K in keyof Raw as K extends Without ? never : K]: K extends keyof F
    ? Hydrated<Raw[K], F[K]>
    : Raw[K];
};

/** Страница с гидратированными элементами. */
export type HydratedPage<Item> = Omit<Page<Item>, 'items'> & { items: Item[] };

/** Пагинатор, отдающий гидратированные страницы и элементы. */
export type HydratedPaginator<Item> = Omit<
  Paginator<Item>,
  'next' | 'pages' | 'collect' | typeof Symbol.asyncIterator
> & {
  next(): Promise<HydratedPage<Item> | null>;
  pages(): AsyncGenerator<HydratedPage<Item>, void, undefined>;
  collect(max?: number): Promise<Item[]>;
  [Symbol.asyncIterator](): AsyncGenerator<Item, void, undefined>;
};

/** Значение `Raw` после гидратации по форме `S`. */
export type Hydrated<Raw, S> = Raw extends null | undefined
  ? Raw
  : S extends ModelShape<infer K>
    ? HydratedModel<K, Raw>
    : S extends ListShape<infer I>
      ? Raw extends readonly (infer Item)[]
        ? Hydrated<Item, I>[]
        : Raw
      : S extends PaginatorShape<infer I>
        ? Raw extends Paginator<infer Item>
          ? HydratedPaginator<Hydrated<Item, I>>
          : Raw
        : S extends FieldsShape<infer F>
          ? HydratedFields<Raw, F>
          : Raw;
