import type { HeadConfig, PageData, SiteData } from 'vitepress';

export const siteUrl = 'https://kiowdev.github.io/itd-api/';
const imageUrl = new URL('og-image.png', siteUrl).href;
const imageAlt = 'itd-api — неофициальный TypeScript SDK для итд.com';

/** relativePath уже учитывает rewrites VitePress. */
export function canonicalUrl(relativePath: string): string {
  const path = relativePath.replace(/(^|\/)index\.md$/, '$1').replace(/\.md$/, '');
  return new URL(path.split('/').map((part) => encodeURIComponent(decodeURIComponent(part))).join('/'), siteUrl).href;
}

/** Повторяет правила titleTemplate установленного VitePress 1.6.4. */
export function pageTitle(page: PageData, site: Pick<SiteData, 'title' | 'titleTemplate'>): string {
  const title = page.title || site.title;
  const template = page.titleTemplate ?? site.titleTemplate;
  if (typeof template === 'string' && template.includes(':title')) {
    return template.replace(/:title/g, title);
  }
  const suffix = template === false || template === site.title
    ? ''
    : ` | ${typeof template === 'string' ? template : site.title}`;
  return title === suffix.slice(3) ? title : `${title}${suffix}`;
}

function generatedDescription(page: PageData): string | undefined {
  const match = page.relativePath.match(/^api\/generated\/([^/]+)\/(.*)\.md$/);
  if (!match) return;
  const entry = match[1]!;
  const packageName = entry === 'core' ? 'itd-api'
    : entry === 'node' || entry === 'web' ? `itd-api/${entry}` : `@itd-api/${entry}`;
  if (match[2] === 'index') {
    return `${packageName} — справочник экспортов, типов и сигнатур TypeScript SDK для итд.com.`;
  }
  const kinds: Record<string, string> = {
    classes: 'класс', interfaces: 'интерфейс', functions: 'функция',
    variables: 'переменная', type_aliases: 'тип', enumerations: 'перечисление',
  };
  const [kind] = match[2]!.split('/');
  const name = page.title.replace(/^(Class|Interface|Function|Variable|Type Alias|Enumeration):\s*/, '');
  return `${name} — ${kinds[kind!] ?? 'символ'} ${packageName}: описание и сигнатуры в TypeScript SDK для итд.com.`;
}

export function applySeo(page: PageData, site: Pick<SiteData, 'title' | 'titleTemplate' | 'head' | 'description'>): void {
  if (page.relativePath === '404.md' || page.isNotFound) return;
  const localHead: HeadConfig[] = page.frontmatter.head ?? [];
  const existing = [...site.head, ...localHead];
  const add = (tag: HeadConfig) => {
    const key = tag[0] === 'link' ? 'rel' : 'property' in tag[1] ? 'property' : 'name';
    if (!existing.some(([type, attrs]) => type === tag[0] && attrs[key] === tag[1][key])) {
      localHead.push(tag);
      existing.push(tag);
    }
  };
  const explicitDescription = localHead.find(([type, attrs]) => type === 'meta' && attrs.name === 'description')?.[1].content;
  const description = page.frontmatter.description || explicitDescription || page.description || generatedDescription(page) || site.description;
  page.description = description;
  page.frontmatter.description = description;
  const title = pageTitle(page, site);
  const url = canonicalUrl(page.relativePath);
  add(['link', { rel: 'canonical', href: url }]);
  for (const [property, content] of Object.entries({
    'og:type': 'website', 'og:site_name': 'itd-api', 'og:locale': 'ru_RU',
    'og:title': title, 'og:description': description, 'og:url': url,
    'og:image': imageUrl, 'og:image:alt': imageAlt,
  })) add(['meta', { property, content }]);
  for (const [name, content] of Object.entries({
    'twitter:card': 'summary_large_image', 'twitter:title': title,
    'twitter:description': description, 'twitter:image': imageUrl, 'twitter:image:alt': imageAlt,
  })) add(['meta', { name, content }]);
  page.frontmatter.head = localHead;
}
