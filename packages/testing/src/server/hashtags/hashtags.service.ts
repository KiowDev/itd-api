import type { Hashtag } from 'itd-api';
import type { PostService } from '../posts/posts.service.js';
import type { PostRecord } from '../posts/posts.types.js';
import { hashtagKey, hashtagNames } from './hashtags.utils.js';

/** Сводка по хэштегу: сколько активных постов и когда появился последний. */
interface HashtagUsage {
  hashtag: Hashtag;
  latestPostAt: string;
}

function byName(a: Hashtag, b: Hashtag): number {
  return a.name.localeCompare(b.name);
}

/** Хэштеги, вычисляемые из разметки активных постов. Отдельно они не хранятся. @internal */
export class HashtagService {
  readonly #posts: PostService;

  constructor(posts: PostService) {
    this.#posts = posts;
  }

  /** Хэштег по имени без учёта регистра и решётки. */
  find(name: string): Hashtag | undefined {
    return this.#usage().get(hashtagKey(name))?.hashtag;
  }

  /** Активные посты с хэштегом, сначала новые. */
  posts(name: string): PostRecord[] {
    const key = hashtagKey(name);
    return this.#posts.feed().filter((post) => hashtagNames(post).includes(key));
  }

  /** Хэштеги свежих постов: сначала те, чей последний пост новее. */
  trending(limit: number): Hashtag[] {
    return [...this.#usage().values()]
      .sort((a, b) => b.latestPostAt.localeCompare(a.latestPostAt) || byName(a.hashtag, b.hashtag))
      .slice(0, limit)
      .map((usage) => usage.hashtag);
  }

  /** Хэштеги, имя которых начинается с запроса, самые популярные первыми. */
  searchByPrefix(query: string, limit: number): Hashtag[] {
    const prefix = hashtagKey(query);
    if (!prefix) return [];
    return [...this.#usage().values()]
      .map((usage) => usage.hashtag)
      .filter((hashtag) => hashtag.name.startsWith(prefix))
      .sort((a, b) => b.postsCount - a.postsCount || byName(a, b))
      .slice(0, limit);
  }

  #usage(): Map<string, HashtagUsage> {
    const usage = new Map<string, HashtagUsage>();
    for (const post of this.#posts.feed()) {
      for (const name of hashtagNames(post)) {
        const current = usage.get(name);
        if (current) {
          current.hashtag.postsCount += 1;
          if (post.createdAt > current.latestPostAt) current.latestPostAt = post.createdAt;
        } else {
          usage.set(name, {
            hashtag: { id: `hashtag-${name}`, name, postsCount: 1 },
            latestPostAt: post.createdAt,
          });
        }
      }
    }
    return usage;
  }
}
