import { defineConfig } from 'vitepress';
import cacheSidebar from './api/generated/cache/typedoc-sidebar.json';
import coreSidebar from './api/generated/core/typedoc-sidebar.json';
import cryptoSidebar from './api/generated/crypto/typedoc-sidebar.json';
import nodeSidebar from './api/generated/node/typedoc-sidebar.json';
import proxySidebar from './api/generated/proxy/typedoc-sidebar.json';
import turnstileSidebar from './api/generated/turnstile/typedoc-sidebar.json';
import packageJson from '../../package.json';

const guideSidebar = [
  {
    text: 'Начало работы',
    items: [
      { text: 'Обзор руководств', link: '/guides/' },
      { text: 'Быстрый старт', link: '/quickstart/' },
      { text: 'Авторизация и сессии', link: '/authentication/' },
      { text: 'Конфигурация', link: '/configuration/' },
    ],
  },
  {
    text: 'Практические сценарии',
    items: [
      { text: 'Realtime', link: '/realtime/' },
      { text: 'Несколько аккаунтов', link: '/multi-accounts/' },
      { text: 'Разметка текста', link: '/text-markup/' },
      { text: 'Интеграции', link: '/integrations/' },
      { text: 'Плагины', link: '/plugins/' },
    ],
  },
  {
    text: 'Дальше',
    items: [
      { text: 'Справочник', link: '/reference/' },
      { text: 'API из TSDoc', link: '/api/' },
      { text: 'Пакеты', link: '/packages/' },
    ],
  },
];

const referenceSidebar = [
  {
    text: 'Справочник',
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
      { text: 'Realtime', link: '/reference/realtime' },
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
      { text: 'Несколько аккаунтов', link: '/reference/accounts' },
    ],
  },
  {
    text: 'Типы и механика',
    collapsed: true,
    items: [
      { text: 'Модели', link: '/reference/models' },
      { text: 'Перечисления', link: '/reference/enums' },
      { text: 'Ошибки', link: '/reference/errors' },
      { text: 'Билдеры', link: '/reference/builders' },
      { text: 'Пагинация', link: '/reference/pagination' },
      { text: 'Сессии и хранилища', link: '/reference/storage' },
      { text: 'Матрица endpoint', link: '/reference/endpoints' },
    ],
  },
];

const packagesSidebar = [
  {
    text: 'Пакеты',
    items: [
      { text: 'Обзор', link: '/packages/' },
      { text: '@itd-api/cache', link: '/packages/cache' },
      { text: '@itd-api/crypto', link: '/packages/crypto' },
      { text: '@itd-api/proxy', link: '/packages/proxy' },
      { text: '@itd-api/turnstile', link: '/packages/turnstile' },
    ],
  },
  {
    text: 'Точные сигнатуры',
    items: [
      { text: 'itd-api', link: '/api/generated/core/' },
      { text: 'itd-api/node', link: '/api/generated/node/' },
      { text: '@itd-api/cache', link: '/api/generated/cache/' },
      { text: '@itd-api/crypto', link: '/api/generated/crypto/' },
      { text: '@itd-api/proxy', link: '/api/generated/proxy/' },
      { text: '@itd-api/turnstile', link: '/api/generated/turnstile/' },
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
  description: 'TypeScript-клиент REST и realtime API социальной сети итд.com',
  base: '/itd-api/',
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
  head: [
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
        text: 'Руководства',
        items: [
          { text: 'Все руководства', link: '/guides/' },
          { text: 'Авторизация', link: '/authentication/' },
          { text: 'Конфигурация', link: '/configuration/' },
          { text: 'Realtime', link: '/realtime/' },
          { text: 'Несколько аккаунтов', link: '/multi-accounts/' },
        ],
      },
      { text: 'Справочник', link: '/reference/' },
      { text: 'API', link: '/api/' },
      { text: 'Пакеты', link: '/packages/' },
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
      '/api/generated/turnstile/': apiSidebar(
        '@itd-api/turnstile',
        '/api/generated/turnstile/',
        turnstileSidebar,
      ),
      '/api/': packagesSidebar,
      '/': guideSidebar,
    },
    search: {
      provider: 'local',
      options: {
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
    socialLinks: [{ icon: 'github', link: 'https://github.com/KiowDev/itd-api' }],
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
