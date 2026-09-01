import { describe, expect, it } from 'vitest';
import {
  buildTurnstilePage,
  TURNSTILE_SITE_KEY,
  turnstile,
} from '../../src/providers/turnstile.js';

describe('buildTurnstilePage', () => {
  it('подставляет ключ и тему', () => {
    const html = buildTurnstilePage('0xTEST', 'dark');

    expect(html).toContain('sitekey: "0xTEST"');
    expect(html).toContain('theme: "dark"');
  });

  it('грузит скрипт капчи так же, как сам сайт', () => {
    const html = buildTurnstilePage('0xTEST', 'auto');

    expect(html).toContain(
      'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad',
    );
    expect(html).toContain('window.turnstile.render');
  });

  it('не передаёт action и cdata — сайт их не передаёт тоже', () => {
    const html = buildTurnstilePage('0xTEST', 'auto');

    expect(html).not.toContain('action');
    expect(html).not.toContain('cdata');
  });

  it('не даёт ключу сломать разметку страницы', () => {
    const html = buildTurnstilePage('"</script><script>alert(1)</script>', 'auto');

    expect(html).not.toContain('<script>alert(1)</script>');
  });
});

describe('turnstile', () => {
  it('берёт ключ итд.com по умолчанию', () => {
    expect(turnstile().buildPage({ theme: 'auto' })).toContain(TURNSTILE_SITE_KEY);
  });

  it('называется так же, как провайдера называет сервер', () => {
    expect(turnstile().type).toBe('cloudflare');
  });

  it('считает отказ по домену постоянным, а внутренний сбой — временным', () => {
    const handler = turnstile();

    expect(handler.isPermanentWidgetError('110200')).toBe(true);
    expect(handler.isPermanentWidgetError('300010')).toBe(false);
  });

  it('отклоняет пустой ключ', () => {
    expect(() => turnstile({ sitekey: '  ' })).toThrow(TypeError);
  });
});
