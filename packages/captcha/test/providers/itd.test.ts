import { describe, expect, it } from 'vitest';
import { buildItdCaptchaPage, ITD_CAPTCHA_SITE_KEY, itdCaptcha } from '../../src/providers/itd.js';

describe('buildItdCaptchaPage', () => {
  const base = {
    sitekey: 'sk_test',
    theme: 'dark' as const,
    action: 'login',
    captchaOrigin: 'https://captcha.example',
  };

  it('встраивает iframe виджета с ключом, темой и назначением', () => {
    const html = buildItdCaptchaPage(base);

    expect(html).toContain('https://captcha.example/widget.html');
    expect(html).toContain('sitekey=sk_test');
    expect(html).toContain('theme=dark');
    expect(html).toContain('action=login');
  });

  it('принимает postMessage только от origin виджета', () => {
    const html = buildItdCaptchaPage(base);

    expect(html).toContain('event.origin !== "https://captcha.example"');
  });

  it('кладёт токен из postMessage в скрытое поле DOM', () => {
    const html = buildItdCaptchaPage(base);

    expect(html).toContain("data.type === 'token'");
    expect(html).toContain('token.value = data.token');
    // В DOM, а не в window: из изолированного мира стелс-драйвера видно только DOM.
    expect(html).toContain('id="itd-token"');
  });

  it('экранирует назначение и origin в разметке', () => {
    const html = buildItdCaptchaPage({
      ...base,
      action: '"</script><script>alert(1)</script>',
    });

    expect(html).not.toContain('<script>alert(1)</script>');
  });
});

describe('itdCaptcha', () => {
  it('берёт ключ, адрес виджета и назначение по умолчанию', () => {
    const html = itdCaptcha().buildPage({ theme: 'auto' });

    expect(html).toContain(ITD_CAPTCHA_SITE_KEY);
    expect(html).toContain('https://captcha.xn--d1ah4a.com/widget.html');
    expect(html).toContain('action=login');
  });

  it('передаёт назначение токена в адрес виджета', () => {
    expect(itdCaptcha({ action: 'password_reset' }).buildPage({ theme: 'auto' })).toContain(
      'action=password_reset',
    );
  });

  it('называется так же, как провайдера называет сервер', () => {
    expect(itdCaptcha().type).toBe('itd');
  });

  it('не знает постоянных кодов: виджет просит повторить', () => {
    expect(itdCaptcha().isPermanentWidgetError('error')).toBe(false);
  });

  it('отклоняет некорректные настройки', () => {
    expect(() => itdCaptcha({ action: '' })).toThrow(TypeError);
    expect(() => itdCaptcha({ sitekey: '' })).toThrow(TypeError);
    expect(() => itdCaptcha({ captchaOrigin: 'не-адрес' })).toThrow(TypeError);
    expect(() => itdCaptcha({ captchaOrigin: 'ftp://example.com' })).toThrow(TypeError);
  });
});
