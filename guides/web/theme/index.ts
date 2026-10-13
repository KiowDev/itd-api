import DefaultTheme from 'vitepress/theme';
import type { Theme } from 'vitepress';
import './custom.css';

export default {
  extends: DefaultTheme,
  enhanceApp({ router }) {
    // Встроенная 404 не проходит transformPageData. Передаём тег менеджеру head,
    // чтобы noindex также удалялся при переходе с 404 на обычную страницу.
    router.onAfterRouteChanged = () => {
      if (router.route.data.isNotFound) {
        router.route.data.frontmatter.head = [['meta', { name: 'robots', content: 'noindex' }]];
      }
    };
  },
} satisfies Theme;
