import type { ModelKind } from '../models/model.constants.js';
import { ShapeKind } from './shape.constants.js';
import type {
  FieldShapes,
  FieldsShape,
  ListShape,
  ModelShape,
  PaginatorShape,
  ShapeBase,
} from './shape.types.js';

/** Модель вида `kind`. */
export function model<K extends ModelKind>(kind: K): ModelShape<K> {
  return Object.freeze({ kind: ShapeKind.Model, model: kind });
}

/** Массив элементов формы `item`. */
export function list<I extends ShapeBase>(item: I): ListShape<I> {
  return Object.freeze({ kind: ShapeKind.List, item });
}

/** Пагинатор элементов формы `item`. */
export function paginator<I extends ShapeBase>(item: I): PaginatorShape<I> {
  return Object.freeze({ kind: ShapeKind.Paginator, item });
}

/** Запись, в которой гидратируются только поля из `shapes`. */
export function fields<F extends FieldShapes>(shapes: F): FieldsShape<F> {
  return Object.freeze({ kind: ShapeKind.Fields, fields: shapes });
}

/** Страница `Page` с элементами формы `item`. */
export function page<I extends ShapeBase>(item: I): FieldsShape<{ readonly items: ListShape<I> }> {
  return fields({ items: list(item) });
}
