import type { Author, OriginalPost, Page, Paginator, Post, Span } from 'itd-api';
import { describe, expectTypeOf, it } from 'vitest';
import type { ModelKind } from '../../src/models/model.constants.js';
import type { HydratedPostActions } from '../../src/models/post/post.types.js';
import type {
  FieldsShape,
  Hydrated,
  ListShape,
  ModelShape,
  PaginatorShape,
} from '../../src/shapes/shape.types.js';

type PostShape = ModelShape<typeof ModelKind.Post>;
type UserShape = ModelShape<typeof ModelKind.User>;

describe('Hydrated', () => {
  it('меняет только поля схемы и сохраняет их необязательность', () => {
    type Result = Hydrated<Post & { related: Post }, PostShape>;

    expectTypeOf<Result['spans']>().toEqualTypeOf<Span[]>();
    expectTypeOf<Result['related']>().toEqualTypeOf<Post>();
    expectTypeOf<Result['wallRecipient']>().toEqualTypeOf<
      Hydrated<Author, UserShape> | null | undefined
    >();
    expectTypeOf<
      Exclude<keyof Hydrated<OriginalPost, PostShape>, keyof HydratedPostActions>
    >().toEqualTypeOf<keyof OriginalPost>();
  });

  it('гидратирует элементы страниц и пагинаторов', () => {
    type PageShape = FieldsShape<{ readonly items: ListShape<PostShape> }>;

    expectTypeOf<Hydrated<Page<Post>, PageShape>['items']>().toEqualTypeOf<
      Hydrated<Post, PostShape>[]
    >();
    expectTypeOf<
      ReturnType<Hydrated<Paginator<Post>, PaginatorShape<PostShape>>['collect']>
    >().toEqualTypeOf<Promise<Hydrated<Post, PostShape>[]>>();
  });
});
