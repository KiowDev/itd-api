import { describe, expect, it } from 'vitest';
import { post } from '../src/builders/post.js';
import { parseHtml, parseMarkdown } from '../src/spans/parse.js';
import { renderSpans, SpanRenderFormat } from '../src/spans/render.js';
import { SpanType } from '../src/types/enums.js';
import type { Span } from '../src/types/models.js';

describe('parseMarkdown', () => {
  it('считает UTF-16 offsets и сохраняет вложенные стили', () => {
    expect(parseMarkdown('🙂 **жирный _текст_** и [ссылка](https://example.com/a)')).toEqual({
      content: '🙂 жирный текст и ссылка',
      spans: [
        { type: SpanType.Bold, offset: 3, length: 12 },
        { type: SpanType.Italic, offset: 10, length: 5 },
        {
          type: SpanType.Link,
          offset: 18,
          length: 6,
          url: 'https://example.com/a',
        },
      ],
    });
  });

  it('поддерживает цитаты, fenced code и inline code', () => {
    expect(parseMarkdown('> **цитата**\n\n```\nconst x = 1;\n```\n`код`')).toEqual({
      content: 'цитата\n\nconst x = 1;\nкод',
      spans: [
        { type: SpanType.Bold, offset: 0, length: 6 },
        { type: SpanType.Quote, offset: 0, length: 6 },
        { type: SpanType.Monospace, offset: 8, length: 12 },
        { type: SpanType.Monospace, offset: 21, length: 3 },
      ],
    });
  });

  it('не активирует опасные ссылки и оставляет alt изображения обычным текстом', () => {
    expect(
      parseMarkdown(
        '[нажми](javascript:alert(1)) ![картинка](https://example.com/a.png) [ok](https://example.com)',
      ),
    ).toEqual({
      content: 'нажми картинка ok',
      spans: [
        {
          type: SpanType.Link,
          offset: 15,
          length: 2,
          url: 'https://example.com',
        },
      ],
    });
  });

  it('оставляет неподдерживаемую и незакрытую разметку текстом', () => {
    expect(parseMarkdown('# Заголовок\n- пункт\n**не закрыто')).toEqual({
      content: '# Заголовок\n- пункт\n**не закрыто',
      spans: [],
    });
  });

  it('при необходимости разрешает дополнительную безопасную схему', () => {
    expect(
      parseMarkdown('[внутри](itd://profile/nowkie)', {
        allowedLinkProtocols: ['https', 'itd'],
      }),
    ).toEqual({
      content: 'внутри',
      spans: [
        {
          type: SpanType.Link,
          offset: 0,
          length: 6,
          url: 'itd://profile/nowkie',
        },
      ],
    });
  });

  it('собирается напрямую через PostBuilder', () => {
    expect(post().markdown('**важно**').build()).toEqual({
      content: 'важно',
      spans: [{ type: SpanType.Bold, offset: 0, length: 5 }],
    });
  });
});

describe('parseHtml', () => {
  it('читает allowlist тегов, entities и вложенность', () => {
    expect(
      parseHtml(
        '<p>🙂 <strong>важно <em>сейчас</em></strong></p>' +
          '<p><a href="https://example.com?a=1&amp;b=2">ссылка</a></p>',
      ),
    ).toEqual({
      content: '🙂 важно сейчас\nссылка',
      spans: [
        { type: SpanType.Bold, offset: 3, length: 12 },
        { type: SpanType.Italic, offset: 9, length: 6 },
        {
          type: SpanType.Link,
          offset: 16,
          length: 6,
          url: 'https://example.com?a=1&b=2',
        },
      ],
    });
  });

  it('не завершает тег символом > внутри значения атрибута', () => {
    expect(
      parseHtml(
        '<a title="1 > 0" href="https://example.com">ссылка</a>' + "<img alt='ширина > высоты'>",
      ),
    ).toEqual({
      content: 'ссылкаширина > высоты',
      spans: [
        {
          type: SpanType.Link,
          offset: 0,
          length: 6,
          url: 'https://example.com',
        },
      ],
    });
  });

  it('удаляет активные элементы, event attributes и опасный href', () => {
    expect(
      parseHtml(
        '<script>alert(1)</script><svg><script>x</script></svg>' +
          '<p onclick="steal()">текст <a href="javascript:steal()">ссылки</a></p>',
      ),
    ).toEqual({
      content: 'текст ссылки',
      spans: [],
    });
  });

  it('сохраняет alt изображения и текст неизвестных тегов', () => {
    expect(parseHtml('<custom>до<img src=x alt="фото &amp; подпись">после</custom>')).toEqual({
      content: 'дофото & подписьпосле',
      spans: [],
    });
  });

  it('понимает spoiler HTML, который создаёт renderSpans', () => {
    const markup = parseHtml('<span class="itd-spoiler" data-spoiler="true">тайна</span>');
    expect(markup).toEqual({
      content: 'тайна',
      spans: [{ type: SpanType.Spoiler, offset: 0, length: 5 }],
    });
  });
});

describe('round-trip разметки', () => {
  it('возвращает поддерживаемое подмножество Markdown без потери текста и spans', () => {
    const content = 'жирно курсив зачёркнуто скрыто код ссылка';
    const spans: Span[] = [
      { type: SpanType.Bold, offset: 0, length: 5 },
      { type: SpanType.Italic, offset: 6, length: 6 },
      { type: SpanType.Strike, offset: 13, length: 10 },
      { type: SpanType.Spoiler, offset: 24, length: 6 },
      { type: SpanType.Monospace, offset: 31, length: 3 },
      {
        type: SpanType.Link,
        offset: 35,
        length: 6,
        url: 'https://example.com/',
      },
    ];

    const rendered = renderSpans(content, spans, { format: SpanRenderFormat.Markdown });
    expect(parseMarkdown(rendered)).toEqual({ content, spans });
  });

  it('возвращает поддерживаемое подмножество HTML без потери текста и spans', () => {
    const content = 'жирно и подчёркнуто';
    const spans: Span[] = [
      { type: SpanType.Bold, offset: 0, length: 5 },
      { type: SpanType.Underline, offset: 8, length: 11 },
    ];

    const rendered = renderSpans(content, spans, { format: SpanRenderFormat.Html });
    expect(parseHtml(rendered)).toEqual({ content, spans });
  });
});
