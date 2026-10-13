import type { HeadConfig, PageData } from 'vitepress';
import { describe, expect, it } from 'vitest';
import { applySeo, canonicalUrl, pageTitle } from '../guides/web/seo';

const site = { title: 'itd-api', description: 'Общее описание', head: [] };
const page = (relativePath: string, title = 'Пример'): PageData => ({
  relativePath,
  filePath: relativePath,
  title,
  description: '',
  headers: [],
  frontmatter: {},
});

describe('метаданные документации', () => {
  it.each([
    ['index.md', ''],
    ['guides/index.md', 'guides/'],
    ['reference/client.md', 'reference/client'],
    ['api/generated/core/index.md', 'api/generated/core/'],
    ['api/generated/core/classes/ItdClient.md', 'api/generated/core/classes/ItdClient'],
    ['пример.md', '%D0%BF%D1%80%D0%B8%D0%BC%D0%B5%D1%80'],
    ['%D0%BF%D1%80%D0%B8%D0%BC%D0%B5%D1%80.md', '%D0%BF%D1%80%D0%B8%D0%BC%D0%B5%D1%80'],
  ])('сохраняет публичный путь %s', (source, path) => {
    expect(canonicalUrl(source)).toBe(`https://kiowdev.github.io/itd-api/${path}`);
  });

  it('согласует OG с titleTemplate VitePress', () => {
    const data = page('index.md', 'itd-api');
    expect(pageTitle(data, site)).toBe('itd-api');
    data.title = 'Пример';
    expect(pageTitle(data, site)).toBe('Пример | itd-api');
    data.titleTemplate = false;
    expect(pageTitle(data, site)).toBe('Пример');
    data.titleTemplate = ':title — справочник';
    expect(pageTitle(data, site)).toBe('Пример — справочник');
    data.titleTemplate = 'SDK';
    expect(pageTitle(data, site)).toBe('Пример | SDK');
  });

  it('сохраняет ручные метаданные и не накапливает теги', () => {
    const data = page('quickstart/index.md');
    data.frontmatter.description = 'Ручное описание';
    data.frontmatter.head = [['meta', { property: 'og:title', content: 'Ручной OG' }]];
    applySeo(data, site);
    const first = structuredClone(data.frontmatter.head);
    applySeo(data, site);
    expect(data.frontmatter.head).toEqual(first);
    expect(data.description).toBe('Ручное описание');
    expect(data.frontmatter.head).toContainEqual([
      'meta',
      { property: 'og:title', content: 'Ручной OG' },
    ]);
    const globalSite = {
      ...site,
      head: [
        ['meta', { property: 'og:image', content: 'https://example.com/card.png' }],
      ] as HeadConfig[],
    };
    const other = page('reference/index.md');
    applySeo(other, globalSite);
    expect(other.frontmatter.head.some((tag: HeadConfig) => tag[1].property === 'og:image')).toBe(
      false,
    );
  });

  it('указывает пакет TypeDoc и пропускает 404', () => {
    const core = page('api/generated/core/classes/ItdClient.md', 'Class: ItdClient');
    const cache = page('api/generated/cache/interfaces/Options.md', 'Interface: Options');
    applySeo(core, site);
    applySeo(cache, site);
    expect(core.description).toContain('ItdClient — класс itd-api');
    expect(cache.description).toContain('Options — интерфейс @itd-api/cache');
    const missing = page('404.md');
    applySeo(missing, site);
    expect(missing.frontmatter.head).toBeUndefined();
  });
});
