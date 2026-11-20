import type { HydrationContext } from '../runtime/context.types.js';
import { hydrateValue, type ModelBinding } from '../runtime/walk.utils.js';
import { list, page } from '../shapes/shape.factory.js';
import type { ShapeBase } from '../shapes/shape.types.js';

async function* hydrateEach(
  source: AsyncIterable<unknown>,
  shape: ShapeBase,
  context: HydrationContext,
  bind: ModelBinding | undefined,
): AsyncGenerator<unknown, void, undefined> {
  for await (const value of source) yield hydrateValue(value, shape, context, bind);
}

/** Оборачивает пагинатор: страницы и элементы, которые он отдаёт, гидратируются по форме `item`. */
export function paginatorFacade(
  paginator: object,
  item: ShapeBase,
  context: HydrationContext,
  bind?: ModelBinding,
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
            return hydrateValue(result, pageShape, context, bind);
          case 'collect':
            return hydrateValue(result, listShape, context, bind);
          case 'pages':
            return hydrateEach(result as AsyncIterable<unknown>, pageShape, context, bind);
          case Symbol.asyncIterator:
            return hydrateEach(result as AsyncIterable<unknown>, item, context, bind);
          default:
            return result;
        }
      };
    },
  });
}
