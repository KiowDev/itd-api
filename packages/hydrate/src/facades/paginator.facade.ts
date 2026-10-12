import type { HydrationContext } from '../runtime/context.types.js';
import { hydrateValue } from '../runtime/walk.utils.js';
import { list, page } from '../shapes/shape.factory.js';
import type { ShapeBase } from '../shapes/shape.types.js';

async function* hydrateEach(
  source: AsyncIterable<unknown>,
  shape: ShapeBase,
  context: HydrationContext,
): AsyncGenerator<unknown, void, undefined> {
  for await (const value of source) yield hydrateValue(value, shape, context);
}

/** Оборачивает пагинатор: страницы и элементы, которые он отдаёт, гидратируются по форме `item`. */
export function paginatorFacade(
  paginator: object,
  item: ShapeBase,
  context: HydrationContext,
): object {
  const pageShape = page(item);
  const listShape = list(item);

  return new Proxy(paginator, {
    get(target, key) {
      const member = Reflect.get(target, key, target) as unknown;
      if (typeof member !== 'function') return member;

      return (...args: unknown[]) => {
        const result = Reflect.apply(member, target, args) as unknown;
        switch (key) {
          case 'next':
            return hydrateValue(result, pageShape, context);
          case 'collect':
            return hydrateValue(result, listShape, context);
          case 'pages':
            return hydrateEach(result as AsyncIterable<unknown>, pageShape, context);
          case Symbol.asyncIterator:
            return hydrateEach(result as AsyncIterable<unknown>, item, context);
          default:
            return result;
        }
      };
    },
  });
}
