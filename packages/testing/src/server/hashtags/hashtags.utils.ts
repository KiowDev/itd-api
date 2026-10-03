import { SpanType } from 'itd-api';
import type { PostRecord } from '../posts/posts.types.js';

/** Ключ хэштега: без решётки и без учёта регистра. @internal */
export function hashtagKey(name: string): string {
  return name.trim().replace(/^#/, '').toLowerCase();
}

/**
 * Хэштеги поста по его разметке, каждый один раз. Имя берётся из `tag`, а без него — из
 * размеченного фрагмента текста. @internal
 */
export function hashtagNames(post: Pick<PostRecord, 'content' | 'spans'>): string[] {
  const names = new Set<string>();
  for (const span of post.spans) {
    if (span.type !== SpanType.Hashtag) continue;
    const name = hashtagKey(span.tag ?? post.content.slice(span.offset, span.offset + span.length));
    if (name) names.add(name);
  }
  return [...names];
}
