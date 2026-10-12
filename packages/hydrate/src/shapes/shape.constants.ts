/** Вид дескриптора формы. */
export const ShapeKind = Object.freeze({
  /** Модель: копия с действиями и гидратированными полями схемы. */
  Model: 'model',
  /** Массив, каждый элемент которого имеет одну форму. */
  List: 'list',
  /** Пагинатор, элементы которого имеют одну форму. */
  Paginator: 'paginator',
  /** Запись, в которой гидратируются только перечисленные поля. */
  Fields: 'fields',
} as const);
export type ShapeKind = (typeof ShapeKind)[keyof typeof ShapeKind];
