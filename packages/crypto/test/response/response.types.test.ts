import type { MyProfile, Post } from 'itd-api';
import { describe, expectTypeOf, it } from 'vitest';
import type { DecodedFields } from '../../src/index.js';

describe('DecodedFields', () => {
  it('допускает undefined для отсутствующего расшифрованного поля', () => {
    const fields: DecodedFields<'content'> = { content: undefined };
    const post: Pick<Post, 'decoded'> = { decoded: fields };
    const profile: Pick<MyProfile, 'decoded'> = {
      decoded: { displayName: undefined, bio: undefined },
    };

    expectTypeOf(post.decoded).toEqualTypeOf<Post['decoded']>();
    expectTypeOf(profile.decoded).toEqualTypeOf<MyProfile['decoded']>();
  });

  it('ограничивает ключи decoded полями модели', () => {
    expectTypeOf<keyof NonNullable<Post['decoded']>>().toEqualTypeOf<'content'>();
    expectTypeOf<keyof NonNullable<MyProfile['decoded']>>().toEqualTypeOf<'displayName' | 'bio'>();
  });
});
