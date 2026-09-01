import { defineConfig } from 'vitepress';
import cacheSidebar from './api/generated/cache/typedoc-sidebar.json';
import captchaSidebar from './api/generated/captcha/typedoc-sidebar.json';
import coreSidebar from './api/generated/core/typedoc-sidebar.json';
import cryptoSidebar from './api/generated/crypto/typedoc-sidebar.json';
import hydrateSidebar from './api/generated/hydrate/typedoc-sidebar.json';
import nodeSidebar from './api/generated/node/typedoc-sidebar.json';
import proxySidebar from './api/generated/proxy/typedoc-sidebar.json';
import testingSidebar from './api/generated/testing/typedoc-sidebar.json';
import webSidebar from './api/generated/web/typedoc-sidebar.json';
import packageJson from '../../package.json';

const guideSidebar = [
  {
    text: 'Начало работы',
    collapsed: true,
    items: [
      { text: 'Обзор руководств', link: '/guides/' },
      { text: 'Быстрый старт', link: '/quickstart/' },
      { text: 'Авторизация и сессии', link: '/authentication/' },
      { text: 'Конфигурация', link: '/configuration/' },
    ],
  },
  {
    text: 'Практические сценарии',
    collapsed: true,
    items: [
      { text: 'События', link: '/events/' },
      { text: 'Несколько аккаунтов', link: '/multi-accounts/' },
      { text: 'Разметка текста', link: '/text-markup/' },
      { text: 'Интеграции', link: '/integrations/' },
      { text: 'Плагины', link: '/plugins/' },
      { text: 'Подключаемые модули', link: '/features/' },
    ],
  },
  {
    text: 'Дальше',
    collapsed: true,
    items: [
      { text: 'Справочник', link: '/reference/' },
      { text: 'Пакеты', link: '/packages/' },
      { text: 'API из TSDoc', link: '/api/' },
    ],
  },
];

const referenceSidebar = [
  {
    text: 'Справочник',
    collapsed: true,
    items: [
      { text: 'Обзор', link: '/reference/' },
      { text: 'Клиент', link: '/reference/client' },
      { text: 'Авторизация', link: '/reference/auth' },
      { text: 'Пользователи', link: '/reference/users' },
      { text: 'Посты', link: '/reference/posts' },
      { text: 'Комментарии', link: '/reference/comments' },
      { text: 'Уведомления', link: '/reference/notifications' },
      { text: 'Файлы', link: '/reference/files' },
      { text: 'Поиск и обнаружение', link: '/reference/discovery' },
      { text: 'События', link: '/reference/events' },
    ],
  },
  {
    text: 'Остальные ресурсы',
    collapsed: true,
    items: [
      { text: 'Платформа', link: '/reference/platform' },
      { text: 'Подписка', link: '/reference/subscription' },
      { text: 'Верификация', link: '/reference/verification' },
      { text: 'Жалобы', link: '/reference/reports' },
      { text: 'Телеметрия', link: '/reference/telemetry' },
      { text: 'Магазин', link: '/reference/shop' },
      { text: 'Несколько аккаунтов', link: '/reference/accounts' },
    ],
  },
  {
    text: 'Типы и механика',
    collapsed: true,
    items: [
      { text: 'Модели', link: '/reference/models' },
      { text: 'Enum', link: '/reference/enums' },
      { text: 'Ошибки', link: '/reference/errors' },
      { text: 'Билдеры', link: '/reference/builders' },
      { text: 'Пагинация', link: '/reference/pagination' },
      { text: 'Порядок выполнения запроса', link: '/reference/request-pipeline' },
      { text: 'Ограничения частоты', link: '/reference/rate-limits' },
      { text: 'Сессии и хранилища', link: '/reference/storage' },
      { text: 'Методы API', link: '/reference/endpoints' },
    ],
  },
  {
    text: 'Дальше',
    collapsed: true,
    items: [
      { text: 'Пакеты', link: '/packages/' },
      { text: 'API из TSDoc', link: '/api/' },
    ],
  },
];

/**
 * Раздел «Пакеты» — рукописные руководства по каждому пакету.
 *
 * Порядок — по пути приложения: сначала то, без чего не начать работу (вход и сеть),
 * потом ускорение и удобство, в конце — тестирование.
 */
const packagesSidebar = [
  {
    text: 'Пакеты',
    items: [
      { text: 'Обзор', link: '/packages/' },
      { text: '@itd-api/captcha', link: '/packages/captcha' },
      { text: '@itd-api/proxy', link: '/packages/proxy' },
      { text: '@itd-api/cache', link: '/packages/cache' },
      { text: '@itd-api/hydrate', link: '/packages/hydrate' },
      { text: '@itd-api/crypto', link: '/packages/crypto' },
      { text: '@itd-api/testing', link: '/packages/testing' },
    ],
  },
  {
    text: 'Дальше',
    collapsed: true,
    items: [
      { text: 'API из TSDoc', link: '/api/' },
    ],
  },
];

/**
 * Раздел «API» — точки входа сгенерированной документации.
 *
 * Отдельно от `packagesSidebar`: рукописные руководства и сигнатуры из TSDoc — разные
 * разделы, и общее меню делало их неразличимыми.
 */
const apiEntriesSidebar = [
  {
    text: 'API из TSDoc',
    items: [
      { text: 'Обзор', link: '/api/' },
      { text: 'itd-api', link: '/api/generated/core/' },
      { text: 'itd-api/node', link: '/api/generated/node/' },
      { text: 'itd-api/web', link: '/api/generated/web/' },
      { text: '@itd-api/captcha', link: '/api/generated/captcha/' },
      { text: '@itd-api/proxy', link: '/api/generated/proxy/' },
      { text: '@itd-api/cache', link: '/api/generated/cache/' },
      { text: '@itd-api/hydrate', link: '/api/generated/hydrate/' },
      { text: '@itd-api/crypto', link: '/api/generated/crypto/' },
      { text: '@itd-api/testing', link: '/api/generated/testing/' },
    ],
  },
];

const apiSidebar = (
  title: string,
  link: string,
  items: Array<{ text: string; collapsed?: boolean; items?: unknown[] }>,
) => [{ text: title, link }, ...items];

export default defineConfig({
  lang: 'ru-RU',
  title: 'itd-api',
  description: 'TypeScript-клиент REST API и событий социальной сети итд.com',
  base: '/itd-api/',
  sitemap: {
    hostname: 'https://kiowdev.github.io/itd-api/',
  },
  cleanUrls: true,
  lastUpdated: true,
  appearance: true,
  vite: {
    publicDir: 'web/public',
  },
  rewrites: {
    'README.md': 'guides/index.md',
    ':section/README.md': ':section/index.md',
    'web/index.md': 'index.md',
    'web/api/:path*': 'api/:path*',
    'web/packages/:path*': 'packages/:path*',
  },
  markdown: {
    config: (md) => {
      // Таблицу заворачиваем в контейнер: прокрутку берёт на себя он, а сама таблица
      // остаётся полноценной (`display: table`) и растягивается на всю ширину колонки.
      // Без обёртки VitePress делает таблицу `display: block`, и она сжимается по тексту.
      md.renderer.rules.table_open = () => '<div class="table-scroll"><table>';
      md.renderer.rules.table_close = () => '</table></div>';
    },
  },
  head: [
    ['link', { rel: 'describedby', href: '/itd-api/llms.txt' }],
    ['meta', { name: 'yandex-verification', content: '3aea310f682d600b' }],
    [
      'meta',
      {
        name: 'google-site-verification',
        content: '6YWvFoUlnFhIur3xbQAJpxIeZGqmYGkQTMmCM0lI35c',
      },
    ],
    ['meta', { name: 'theme-color', content: '#3b82f6' }],
    [
      'link',
      {
        rel: 'icon',
        type: 'image/svg+xml',
        media: '(prefers-color-scheme: light)',
        href: '/itd-api/logos/itd-api-logo-light.svg',
      },
    ],
    [
      'link',
      {
        rel: 'icon',
        type: 'image/svg+xml',
        media: '(prefers-color-scheme: dark)',
        href: '/itd-api/logos/itd-api-logo.svg',
      },
    ],
  ],
  themeConfig: {
    logo: {
      light: '/logos/itd-api-logo-transparent.svg',
      dark: '/logos/itd-api-logo-transparent-dark.svg',
      alt: 'itd-api',
    },
    siteTitle: 'itd-api',
    nav: [
      { text: 'Быстрый старт', link: '/quickstart/' },
      {
        // Ссылка, а не выпадающий список: заголовок группы в теме не кликается, и попытка
        // открыть обзор руководств упиралась в меню. Сами руководства перечислены на
        // странице обзора и в боковом меню.
        text: 'Руководства',
        link: '/guides/',
        activeMatch:
          '^/(guides|authentication|configuration|events|multi-accounts|text-markup|integrations|plugins|features)/',
      },
      { text: 'Справочник', link: '/reference/' },
      { text: 'Пакеты', link: '/packages/' },
      { text: 'API', link: '/api/' },
      {
        text: `v${packageJson.version}`,
        link: 'https://www.npmjs.com/package/itd-api',
      },
    ],
    sidebar: {
      '/reference/': referenceSidebar,
      '/packages/': packagesSidebar,
      '/api/generated/core/': apiSidebar('itd-api', '/api/generated/core/', coreSidebar),
      '/api/generated/node/': apiSidebar('itd-api/node', '/api/generated/node/', nodeSidebar),
      '/api/generated/web/': apiSidebar('itd-api/web', '/api/generated/web/', webSidebar),
      '/api/generated/testing/': apiSidebar(
        '@itd-api/testing',
        '/api/generated/testing/',
        testingSidebar,
      ),
      '/api/generated/hydrate/': apiSidebar(
        '@itd-api/hydrate',
        '/api/generated/hydrate/',
        hydrateSidebar,
      ),
      '/api/generated/cache/': apiSidebar(
        '@itd-api/cache',
        '/api/generated/cache/',
        cacheSidebar,
      ),
      '/api/generated/crypto/': apiSidebar(
        '@itd-api/crypto',
        '/api/generated/crypto/',
        cryptoSidebar,
      ),
      '/api/generated/proxy/': apiSidebar(
        '@itd-api/proxy',
        '/api/generated/proxy/',
        proxySidebar,
      ),
      '/api/generated/captcha/': apiSidebar(
        '@itd-api/captcha',
        '/api/generated/captcha/',
        captchaSidebar,
      ),
      '/api/': apiEntriesSidebar,
      '/': guideSidebar,
    },
    search: {
      provider: 'local',
      options: {
        _render: (source, env, md) => {
          if (env.relativePath.startsWith('web/api/generated/')) {
            const title = source.match(/^# .+$/m)?.[0];

            if (!title) return '';

            const afterTitle = source.slice(source.indexOf(title) + title.length);
            const beforeSections = afterTitle.split(/^## /m, 1)[0];
            const description = beforeSections
              .replace(/^```[\s\S]*?^```\s*$/gm, '')
              .replace(/^Defined in:.*$/gm, '')
              .replace(/^\*\*\*\s*$/gm, '')
              .trim()
              .split(/\r?\n\s*\r?\n/, 1)[0];

            return md.render(`${title}\n\n${description}`, env);
          }

          const html = md.render(source, env);
          return env.frontmatter?.search === false ? '' : html;
        },
        translations: {
          button: {
            buttonText: 'Поиск',
            buttonAriaLabel: 'Поиск по документации',
          },
          modal: {
            displayDetails: 'Показать подробности',
            resetButtonTitle: 'Сбросить поиск',
            backButtonTitle: 'Закрыть поиск',
            noResultsText: 'Ничего не найдено',
            footer: {
              selectText: 'выбрать',
              selectKeyAriaLabel: 'Enter',
              navigateText: 'перейти',
              navigateUpKeyAriaLabel: 'Стрелка вверх',
              navigateDownKeyAriaLabel: 'Стрелка вниз',
              closeText: 'закрыть',
              closeKeyAriaLabel: 'Escape',
            },
          },
        },
      },
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/KiowDev/itd-api' },
      {
        // У DeepWiki нет иконки в наборе темы, поэтому рисуем свою — раскрытая книга.
        icon: {
          svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M11.25 5.6C9.53 4.2 7.4 3.5 5.25 3.5c-1.06 0-2.11.17-3.12.5A1 1 0 0 0 1.5 5v13.2a1 1 0 0 0 1.31.95c.78-.26 1.6-.4 2.44-.4 1.98 0 3.9.72 5.38 2.03a1 1 0 0 0 1.24 0 8.13 8.13 0 0 1 5.38-2.03c.84 0 1.66.14 2.44.4a1 1 0 0 0 1.31-.95V5a1 1 0 0 0-.63-.95 9.87 9.87 0 0 0-3.12-.55c-2.15 0-4.28.7-6 2.1v12.2a10.1 10.1 0 0 0-.5-.24V5.6Z"/></svg>',
        },
        link: 'https://deepwiki.com/KiowDev/itd-api',
        ariaLabel: 'DeepWiki по исходному коду itd-api',
      },
    ],
    lastUpdated: {
      text: 'Обновлено',
      formatOptions: {
        dateStyle: 'long',
        timeStyle: 'short',
      },
    },
    outline: {
      level: [2, 3],
      label: 'На этой странице',
    },
    docFooter: {
      prev: 'Предыдущая страница',
      next: 'Следующая страница',
    },
    darkModeSwitchLabel: 'Тема',
    lightModeSwitchTitle: 'Включить светлую тему',
    darkModeSwitchTitle: 'Включить тёмную тему',
    sidebarMenuLabel: 'Меню',
    returnToTopLabel: 'Наверх',
    skipToContentLabel: 'Перейти к содержимому',
    langMenuLabel: 'Выбрать язык',
    externalLinkIcon: true,
    footer: {
      message: 'Документация itd-api',
      copyright: 'MIT License',
    },
  },
});
