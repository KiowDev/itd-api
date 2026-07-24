import { describe, expect, it } from 'vitest';
import { autoSpans, markup } from '../src/builders/markup.js';
import { post } from '../src/builders/post.js';
import { ItdConfigError } from '../src/core/errors.js';
import { renderSpans } from '../src/spans/render.js';
import { SpanType } from '../src/types/enums.js';

describe('билдер разметки', () => {
  it('считает смещения хэштега и упоминания', () => {
    const result = markup()
      .text('смотрите ')
      .hashtag('котики')
      .text(' от ')
      .mention('@durov')
      .build();

    expect(result).toEqual({
      content: 'смотрите #котики от @durov',
      spans: [
        { type: SpanType.Hashtag, offset: 9, length: 7, tag: 'котики' },
        { type: SpanType.Mention, offset: 20, length: 6, username: 'durov' },
      ],
    });
  });

  it('использует UTF-16 индексы как редактор сайта', () => {
    const result = markup('🐈 ').bold('кот').build();

    expect(result.spans).toEqual([{ type: SpanType.Bold, offset: 3, length: 3 }]);
  });

  it('умеет накладывать несколько стилей на один фрагмент', () => {
    const result = markup().styled('важно', SpanType.Bold, SpanType.Underline).build();

    expect(result.spans).toEqual([
      { type: SpanType.Bold, offset: 0, length: 5 },
      { type: SpanType.Underline, offset: 0, length: 5 },
    ]);
  });

  it('повторяет вложенное форматирование выделения из редактора сайта', () => {
    const result = markup()
      .bold((fragment) => fragment.text('очень ').underline('важно'))
      .build();

    expect(result).toEqual({
      content: 'очень важно',
      spans: [
        { type: SpanType.Bold, offset: 0, length: 11 },
        { type: SpanType.Underline, offset: 6, length: 5 },
      ],
    });
  });

  it('стабильно сортирует вложенные spans по смещению', () => {
    expect(
      markup()
        .text('a ')
        .bold((m) => m.text('b ').underline('c'))
        .build().spans,
    ).toEqual([
      { type: SpanType.Bold, offset: 2, length: 3 },
      { type: SpanType.Underline, offset: 4, length: 1 },
    ]);
  });

  it('позволяет вложить стиль в ссылку', () => {
    const result = markup()
      .link((fragment) => fragment.bold('документация'), 'https://example.com')
      .build();

    expect(result.spans).toEqual([
      { type: SpanType.Bold, offset: 0, length: 12 },
      { type: SpanType.Link, offset: 0, length: 12, url: 'https://example.com' },
    ]);
  });

  it('встраивается в билдер поста', () => {
    const result = post()
      .markup((m) => m.text('см. ').link('документацию', 'https://example.com/docs'))
      .build();

    expect(result).toEqual({
      content: 'см. документацию',
      spans: [
        {
          type: SpanType.Link,
          offset: 4,
          length: 12,
          url: 'https://example.com/docs',
        },
      ],
    });
  });

  it('проверяет сырые смещения', () => {
    expect(() =>
      post()
        .markup({ content: 'текст', spans: [{ type: SpanType.Bold, offset: 4, length: 10 }] })
        .build(),
    ).toThrow(ItdConfigError);
  });
});

describe('автоматическая разметка', () => {
  it('находит ссылки, unicode-хэштеги и упоминания', () => {
    const text = '🐈 #котики от @durov: https://example.com/a?q=1.';
    const spans = autoSpans(text);

    expect(spans).toEqual([
      {
        type: SpanType.Hashtag,
        offset: text.indexOf('#котики'),
        length: '#котики'.length,
        tag: 'котики',
      },
      {
        type: SpanType.Mention,
        offset: text.indexOf('@durov'),
        length: '@durov'.length,
        username: 'durov',
      },
      {
        type: SpanType.Link,
        offset: text.indexOf('https://'),
        length: 'https://example.com/a?q=1'.length,
        url: 'https://example.com/a?q=1',
      },
    ]);
  });

  it('не включает хвостовую пунктуацию в username', () => {
    const text = 'спасибо @durov. пинг @bot- и @bot_';

    expect(autoSpans(text)).toEqual([
      {
        type: SpanType.Mention,
        offset: text.indexOf('@durov'),
        length: '@durov'.length,
        username: 'durov',
      },
      {
        type: SpanType.Mention,
        offset: text.indexOf('@bot-'),
        length: '@bot'.length,
        username: 'bot',
      },
      {
        type: SpanType.Mention,
        offset: text.indexOf('@bot_'),
        length: '@bot'.length,
        username: 'bot',
      },
    ]);
  });

  it('не принимает email и части URL за упоминания и хэштеги', () => {
    const text = 'mail a@b.com, https://example.com/@user#tag';

    expect(autoSpans(text)).toEqual([
      {
        type: SpanType.Link,
        offset: text.indexOf('https://'),
        length: 'https://example.com/@user#tag'.length,
        url: 'https://example.com/@user#tag',
      },
    ]);
  });

  it('не размечает незавершённый URL', () => {
    expect(autoSpans('адрес https:// пока не дописан')).toEqual([]);
  });

  it('не ищет сущности внутри URL даже при links: false', () => {
    expect(autoSpans('см. https://example.com/@user#tag', { links: false })).toEqual([]);
  });

  it('повторно убирает пунктуацию после лишней закрывающей скобки URL', () => {
    const url = 'https://example.com/Кот_(x)';

    expect(autoSpans(`см. ${url}.)`)).toEqual([
      { type: SpanType.Link, offset: 4, length: url.length, url },
    ]);
  });

  it('сохраняет ручные стили и идемпотентен в PostBuilder', () => {
    const once = post('#тег')
      .spans([{ type: SpanType.Bold, offset: 0, length: 4 }])
      .autoSpans();
    const twice = once.autoSpans();

    expect(twice.build()).toEqual(once.build());
    expect(once.build().spans).toEqual([
      { type: SpanType.Bold, offset: 0, length: 4 },
      { type: SpanType.Hashtag, offset: 0, length: 4, tag: 'тег' },
    ]);
  });
});

describe('renderSpans', () => {
  it('совмещает несколько стилей на одном диапазоне', () => {
    expect(
      renderSpans(
        'важно',
        [
          { type: SpanType.Bold, offset: 0, length: 5 },
          { type: SpanType.Underline, offset: 0, length: 5 },
        ],
        { format: 'html' },
      ),
    ).toBe('<u><strong>важно</strong></u>');
  });

  it('по умолчанию создаёт HTML и принимает отсутствующий массив spans', () => {
    expect(renderSpans('<текст>')).toBe('&lt;текст&gt;');
    expect(renderSpans('текст', undefined)).toBe('текст');
  });

  it('создаёт безопасный HTML и поддерживает пересекающиеся spans', () => {
    const html = renderSpans(
      '<кот>',
      [
        { type: SpanType.Bold, offset: 0, length: 5 },
        { type: SpanType.Link, offset: 1, length: 3, url: 'https://example.com' },
      ],
      { format: 'html' },
    );

    expect(html).toBe(
      '<strong>&lt;</strong>' +
        '<a href="https://example.com/" rel="noopener noreferrer"><strong>кот</strong></a>' +
        '<strong>&gt;</strong>',
    );
  });

  it('не выводит опасную схему ссылки в HTML', () => {
    expect(
      renderSpans('нажми', [{ type: SpanType.Link, offset: 0, length: 5, url: 'javascript:x' }], {
        format: 'html',
      }),
    ).toBe('нажми');
  });

  it('создаёт Markdown и ANSI', () => {
    const spans = [{ type: SpanType.Bold, offset: 0, length: 5 }] as const;

    expect(renderSpans('важно', spans, { format: 'markdown' })).toBe('**важно**');
    expect(renderSpans('важно', spans, { format: 'ansi' })).toBe('\u001b[1mважно\u001b[0m');
  });

  it('выбирает CommonMark-забор длиннее внутренних серий бэктиков', () => {
    const monospace = [{ type: SpanType.Monospace, offset: 0, length: 4 }] as const;
    const surrounded = [{ type: SpanType.Monospace, offset: 0, length: 3 }] as const;

    expect(renderSpans('a``b', monospace, { format: 'markdown' })).toBe('```a``b```');
    expect(renderSpans('`a`', surrounded, { format: 'markdown' })).toBe('`` `a` ``');
  });

  it('применяет Markdown-цитату один раз после сборки вложенных сегментов', () => {
    expect(
      renderSpans(
        'раз два',
        [
          { type: SpanType.Quote, offset: 0, length: 7 },
          { type: SpanType.Bold, offset: 0, length: 3 },
        ],
        { format: 'markdown' },
      ),
    ).toBe('> **раз** два');
  });

  it('строит адрес упоминания из полного span при разрезании другим стилем', () => {
    expect(
      renderSpans(
        '@durov',
        [
          { type: SpanType.Mention, offset: 0, length: 6 },
          { type: SpanType.Bold, offset: 0, length: 3 },
        ],
        { format: 'html' },
      ),
    ).toBe(
      '<a href="/@durov" class="itd-mention"><strong>@du</strong></a>' +
        '<a href="/@durov" class="itd-mention">rov</a>',
    );
  });

  it('предпочитает username и старый tag идентификатору mention', () => {
    expect(
      renderSpans('@durov', [
        {
          type: SpanType.Mention,
          offset: 0,
          length: 6,
          tag: 'durov',
          id: '0193-uuid',
        },
      ]),
    ).toBe('<a href="/@durov" class="itd-mention">@durov</a>');
  });

  it('позволяет настроить маршруты и префикс HTML-классов', () => {
    expect(
      renderSpans(
        '@durov #новости',
        [
          { type: SpanType.Mention, offset: 0, length: 6, username: 'durov' },
          { type: SpanType.Hashtag, offset: 7, length: 8, tag: 'новости' },
        ],
        {
          mentionUrl: (username) => `/users/${username}`,
          hashtagUrl: (tag) => `/topics/${tag}`,
          classPrefix: 'feed',
        },
      ),
    ).toBe(
      '<a href="/users/durov" class="feed-mention">@durov</a> ' +
        '<a href="/topics/новости" class="feed-hashtag">#новости</a>',
    );
  });

  it('может отключить entity-ссылки и HTML-классы', () => {
    expect(
      renderSpans('@durov', [{ type: SpanType.Mention, offset: 0, length: 6, username: 'durov' }], {
        classPrefix: null,
      }),
    ).toBe('<a href="/@durov">@durov</a>');
    expect(
      renderSpans('@durov', [{ type: SpanType.Mention, offset: 0, length: 6, username: 'durov' }], {
        mentionUrl: () => null,
      }),
    ).toBe('@durov');
  });

  it('не принимает опасную схему из пользовательского построителя адреса', () => {
    expect(
      renderSpans('@durov', [{ type: SpanType.Mention, offset: 0, length: 6 }], {
        mentionUrl: () => 'javascript:alert(1)',
      }),
    ).toBe('@durov');
  });

  it('сохраняет mention и hashtag ссылками в Markdown', () => {
    expect(
      renderSpans(
        '@durov и #новости',
        [
          { type: SpanType.Mention, offset: 0, length: 6, username: 'durov' },
          { type: SpanType.Hashtag, offset: 9, length: 8, tag: 'новости' },
        ],
        { format: 'markdown' },
      ),
    ).toBe('[@durov](/@durov) и [#новости](/hashtag/%D0%BD%D0%BE%D0%B2%D0%BE%D1%81%D1%82%D0%B8)');
  });

  it('не экранирует обычные точки и дефисы в Markdown', () => {
    expect(renderSpans('example.com, что-то', [], { format: 'markdown' })).toBe(
      'example.com, что-то',
    );
    expect(renderSpans('# заголовок\n- пункт', [], { format: 'markdown' })).toBe(
      '\\# заголовок\n\\- пункт',
    );
  });

  it('обрезает повреждённый серверный span по строке', () => {
    expect(
      renderSpans('текст', [{ type: SpanType.Italic, offset: 3, length: 99 }], {
        format: 'html',
      }),
    ).toBe('тек<em>ст</em>');
  });
});
