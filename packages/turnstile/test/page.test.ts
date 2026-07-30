import { describe, expect, it } from 'vitest';
import { buildWidgetPage } from '../src/page.js';

describe('buildWidgetPage', () => {
  it('подставляет ключ и тему', () => {
    const html = buildWidgetPage('0xTEST', 'dark');

    expect(html).toContain('sitekey: "0xTEST"');
    expect(html).toContain('theme: "dark"');
  });

  it('грузит скрипт капчи так же, как сам сайт', () => {
    const html = buildWidgetPage('0xTEST', 'auto');

    expect(html).toContain(
      'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad',
    );
    expect(html).toContain('window.turnstile.render');
  });

  it('не передаёт action и cdata — сайт их не передаёт тоже', () => {
    const html = buildWidgetPage('0xTEST', 'auto');

    expect(html).not.toContain('action');
    expect(html).not.toContain('cdata');
  });

  it('не даёт ключу сломать разметку страницы', () => {
    const html = buildWidgetPage('"</script><script>alert(1)</script>', 'auto');

    expect(html).not.toContain('<script>alert(1)</script>');
  });
});
