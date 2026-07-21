import { describe, expect, it } from 'vitest';
import { isBuilder } from '../src/builders/base.js';
import { comment, resolveComment } from '../src/builders/comment.js';
import { type PollBuilder, poll, resolvePoll } from '../src/builders/poll.js';
import { post, resolvePost } from '../src/builders/post.js';
import { report, resolveReport } from '../src/builders/report.js';
import { ItdConfigError } from '../src/core/errors.js';

const UUID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

describe('три формы входа дают один результат', () => {
  it('опрос', () => {
    const expected = {
      question: 'ну как?',
      options: [{ text: 'да' }, { text: 'нет' }],
      multipleChoice: false,
    };

    expect(resolvePoll(expected)).toEqual(expected);
    expect(resolvePoll(poll('ну как?').options('да', 'нет'))).toEqual(expected);
    expect(resolvePoll((q) => q.question('ну как?').options('да', 'нет'))).toEqual(expected);
  });

  it('пост', () => {
    const expected = { content: 'привет' };

    expect(resolvePost(expected)).toEqual(expected);
    expect(resolvePost(post('привет'))).toEqual(expected);
    expect(resolvePost((p) => p.content('привет'))).toEqual(expected);
  });

  it('функция может вернуть обычный объект вместо билдера', () => {
    expect(resolvePost(() => ({ content: 'привет' }))).toEqual({ content: 'привет' });
  });

  it('проверки одинаковы для объекта и для билдера', () => {
    expect(() => resolvePoll({ question: 'а?', options: [{ text: 'да' }] })).toThrow(
      ItdConfigError,
    );
    expect(() => resolvePoll(poll('а?').option('да'))).toThrow(ItdConfigError);
    expect(() => resolvePoll((q) => q.question('а?').option('да'))).toThrow(ItdConfigError);
  });
});

describe('неизменяемость', () => {
  it('заготовка поста не портится', () => {
    const base = post().onWall(UUID);

    const first = base.content('первый').build();
    const second = base.content('второй').build();

    expect(first.content).toBe('первый');
    expect(second.content).toBe('второй');
    expect(first.wallRecipientId).toBe(UUID);
  });

  it('заготовка опроса не портится', () => {
    const base = poll('вопрос').option('а');

    const withB = base.option('б').build();
    const withC = base.option('в').build();

    expect(withB.options.map((o) => o.text)).toEqual(['а', 'б']);
    expect(withC.options.map((o) => o.text)).toEqual(['а', 'в']);
  });

  it('build не меняет билдер и вызывается повторно', () => {
    const builder = poll('вопрос').options('а', 'б');

    expect(builder.build()).toEqual(builder.build());
  });
});

describe('билдер опроса', () => {
  it('multipleChoice отправляется всегда — сервер требует это поле', () => {
    // Без него создание поста с опросом падает с ошибкой валидации.
    expect(poll('в').options('а', 'б').build().multipleChoice).toBe(false);
    expect(poll('в').options('а', 'б').multipleChoice().build().multipleChoice).toBe(true);
  });

  it('multipleChoice есть и при передаче обычным объектом', () => {
    expect(resolvePoll({ question: 'в', options: [{ text: 'а' }, { text: 'б' }] })).toEqual({
      question: 'в',
      options: [{ text: 'а' }, { text: 'б' }],
      multipleChoice: false,
    });
  });

  it.each([
    ['вопрос длиннее 200 символов', () => poll('я'.repeat(201)).options('а', 'б'), /200/],
    ['вариант длиннее 100 символов', () => poll('в').options('а'.repeat(101), 'б'), /100/],
    [
      'больше 10 вариантов',
      () => poll('в').options(...Array.from({ length: 11 }, (_, i) => `в${i}`)),
      /не больше 10/,
    ],
  ])('соблюдает ограничения: %s', (_name, make, pattern) => {
    expect(() => make().build()).toThrow(pattern);
  });

  it('обрезает пробелы в вопросе и вариантах', () => {
    const result = poll('  вопрос  ').options('  да  ', ' нет ').build();

    expect(result.question).toBe('вопрос');
    expect(result.options).toEqual([{ text: 'да' }, { text: 'нет' }]);
  });

  it.each([
    ['пустой вопрос', () => poll('').options('а', 'б'), /непустого вопроса/],
    ['один вариант', () => poll('в').option('а'), /минимум 2 варианта, передано: 1/],
    ['пустой вариант', () => poll('в').options('а', '  '), /Вариант ответа №2 пуст/],
    ['дубль варианта', () => poll('в').options('да', 'да'), /повторяется/],
  ])('отвергает: %s', (_name, make, pattern) => {
    expect(() => make().build()).toThrow(pattern);
  });
});

describe('билдер поста', () => {
  it('собирает текст, вложения и опрос', () => {
    const result = post('текст')
      .attachId('att-1')
      .attach('./a.png')
      .poll((q) => q.question('ну как?').options('да', 'нет'))
      .build();

    expect(result).toMatchObject({
      content: 'текст',
      attachmentIds: ['att-1'],
      files: ['./a.png'],
      poll: { question: 'ну как?' },
    });
  });

  it('append дописывает текст через перевод строки', () => {
    expect(post('первая').append('вторая').build().content).toBe('первая\nвторая');
    expect(post().append('одна').build().content).toBe('одна');
  });

  it('сохраняет порядок вложений', () => {
    const result = post('т').attach('./1.png').attach('./2.png').attach('./3.png').build();

    expect(result.files).toEqual(['./1.png', './2.png', './3.png']);
  });

  it('пост только с опросом допустим', () => {
    expect(() =>
      post()
        .poll((q) => q.question('в').options('а', 'б'))
        .build(),
    ).not.toThrow();
  });

  it('пост только с вложением допустим', () => {
    expect(() => post().attach('./a.png').build()).not.toThrow();
  });

  it('отвергает пустой пост', () => {
    expect(() => post().build()).toThrow(/Пост пуст/);
    expect(() => post('   ').build()).toThrow(/Пост пуст/);
  });

  it('требует UUID для стены и подсказывает, где его взять', () => {
    expect(() => post('т').onWall('durov').build()).toThrow(/должен быть UUID/);
    expect(() => post('т').onWall('durov').build()).toThrow(/itd\.users\.get/);
  });

  it('принимает корректный UUID стены', () => {
    expect(post('т').onWall(UUID).build().wallRecipientId).toBe(UUID);
  });

  it('принимает билдер опроса внутри обычного объекта', () => {
    const survey = poll('ну как?').options('да', 'нет');

    expect(resolvePost({ content: 'голосуем', poll: survey })).toEqual({
      content: 'голосуем',
      poll: {
        question: 'ну как?',
        options: [{ text: 'да' }, { text: 'нет' }],
        multipleChoice: false,
      },
    });
  });

  it('принимает функцию-настройщик опроса внутри обычного объекта', () => {
    // Внутри объекта тип параметра приходится указать: контекстная типизация не проходит
    // сквозь union на входе метода. В основной форме post().poll((q) => …) он выводится сам.
    const result = resolvePost({
      content: 'голосуем',
      poll: (q: PollBuilder) => q.question('ну как?').options('да', 'нет'),
    });

    expect(result.poll).toEqual({
      question: 'ну как?',
      options: [{ text: 'да' }, { text: 'нет' }],
      multipleChoice: false,
    });
  });

  it('проверяет опрос и внутри обычного объекта', () => {
    expect(() =>
      resolvePost({ content: 'т', poll: { question: 'в', options: [{ text: 'а' }] } }),
    ).toThrow(/минимум 2 варианта/);
  });

  it('вложенный опрос проверяется вместе с постом', () => {
    expect(() =>
      post('т')
        .poll((q) => q.question('в').option('а'))
        .build(),
    ).toThrow(/минимум 2 варианта/);
  });
});

describe('билдер комментария', () => {
  it('собирает текст и вложения', () => {
    const result = comment('согласен').attach('./meme.png').build();

    expect(result).toMatchObject({ content: 'согласен', files: ['./meme.png'] });
  });

  it('отвергает пустой комментарий', () => {
    expect(() => comment().build()).toThrow(/Комментарий пуст/);
  });

  it('голосовой требует ровно одно вложение и никакого текста', () => {
    expect(() => comment().voice('./a.ogg').build()).not.toThrow();
    expect(() => comment('текст').voice('./a.ogg').build()).toThrow(/не может быть текста/);
    expect(() => comment().voice('./a.ogg').attach('./b.ogg').build()).toThrow(
      /ровно одно аудиовложение, передано: 2/,
    );
  });

  it('replyTo запрещён в комментарии к посту', () => {
    expect(() => resolveComment(comment('т').replyTo(UUID))).toThrow(/только к ответу/);
  });

  it('replyTo разрешён в ответе на комментарий', () => {
    expect(resolveComment(comment('т').replyTo(UUID), true).replyToUserId).toBe(UUID);
  });
});

describe('билдер жалобы', () => {
  it('связывает тип и идентификатор', () => {
    expect(report.post('p-1').reason('spam').build()).toEqual({
      targetType: 'post',
      targetId: 'p-1',
      reason: 'spam',
    });
    expect(report.comment('c-1').reason('hate').build().targetType).toBe('comment');
    expect(report.user('u-1').reason('fraud').build().targetType).toBe('user');
  });

  it('добавляет пояснение', () => {
    expect(report.user('u-1').reason('other').description('пишет в личку').build()).toMatchObject({
      description: 'пишет в личку',
    });
  });

  it('требует причину', () => {
    expect(() => report.post('p-1').build()).toThrow(/Неизвестная причина/);
  });

  it('отвергает неизвестную причину и перечисляет допустимые', () => {
    expect(() =>
      resolveReport({ targetType: 'post', targetId: 'p', reason: 'нечто' as never }),
    ).toThrow(/spam, violence, hate, adult, fraud, other/);
  });

  it('отвергает неизвестный тип объекта', () => {
    expect(() =>
      resolveReport({ targetType: 'story' as never, targetId: 'p', reason: 'spam' }),
    ).toThrow(/targetType/);
  });

  it('требует идентификатор', () => {
    expect(() => resolveReport({ targetType: 'post', targetId: '', reason: 'spam' })).toThrow(
      /targetId/,
    );
  });
});

describe('служебное', () => {
  it('isBuilder распознаёт билдеры', () => {
    expect(isBuilder(poll('в'))).toBe(true);
    expect(isBuilder(post('т'))).toBe(true);
    expect(isBuilder({ question: 'в' })).toBe(false);
    expect(isBuilder(null)).toBe(false);
  });

  it('JSON.stringify собирает билдер', () => {
    const json = JSON.stringify({ poll: poll('в').options('а', 'б') });

    expect(JSON.parse(json)).toEqual({
      poll: { question: 'в', options: [{ text: 'а' }, { text: 'б' }], multipleChoice: false },
    });
  });
});
