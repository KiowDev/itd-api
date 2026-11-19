import { useData } from 'vitepress';
import DefaultTheme from 'vitepress/theme';
import type { Theme } from 'vitepress';
import { h } from 'vue';
import DeepWikiAssistant from './deepwiki/Assistant.vue';
import './custom.css';

export default {
  extends: DefaultTheme,
  Layout() {
    const { frontmatter, page } = useData();
    return h(DefaultTheme.Layout, null, {
      'layout-bottom': () =>
        frontmatter.value.layout !== 'home' && !page.value.isNotFound
          ? h(DeepWikiAssistant)
          : null,
    });
  },
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
