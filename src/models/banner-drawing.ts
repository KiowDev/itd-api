/** Инструменты редактора баннера в формате версии 1. */
export const BannerDrawingTool = Object.freeze({
  Brush: 'brush',
  Eraser: 'eraser',
  Line: 'line',
  Rectangle: 'rectangle',
  Circle: 'circle',
} as const);
export type BannerDrawingTool = (typeof BannerDrawingTool)[keyof typeof BannerDrawingTool];

/** Координаты точки в пикселях холста. */
export type BannerDrawingPoint = readonly [x: number, y: number];

/** Штрих или фигура, которую нужно нарисовать на холсте. */
export interface BannerDrawingOperation {
  tool: BannerDrawingTool;
  /** Цвет в формате CSS hex, например `#000000`. */
  color: string;
  /** Толщина линии в пикселях. */
  width: number;
  /** Точки штриха. Для линии, прямоугольника и круга передайте две точки. */
  points: readonly BannerDrawingPoint[];
}

/** Описание рисунка для загрузки в качестве баннера. */
export interface BannerDrawing {
  version: 1;
  /** Ширина холста в пикселях. */
  width: number;
  /** Высота холста в пикселях. */
  height: number;
  /** Операции в порядке рисования. */
  ops: readonly BannerDrawingOperation[];
}

/** Изображение, созданное сервером из рисунка. */
export interface UploadedBannerDrawing {
  /** Идентификатор для поля `bannerId` при обновлении профиля. */
  id: string;
  url: string;
  width: number;
  height: number;
}
