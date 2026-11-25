import { ChatUpdateType } from 'itd-api';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { ChatBot, ChatBotFilter, ChatComposer, ChatContext } from '../../src/index.js';
import { setup } from '../helpers/bot.fixtures.js';

const baseMessage = { messageId: 'm1', senderId: 'u1', createdAt: '2026-11-20T00:00:00.000Z' };

describe('ChatComposer', () => {
  it('уточняет контекст дочерней ветки и запускает пересекающиеся обработчики по порядку', async () => {
    const { itd } = setup();
    class AppContext extends ChatContext {
      readonly label: string = 'app';
    }
    const composer = new ChatComposer<AppContext>();
    const commands = new ChatComposer<AppContext>();
    const seen: string[] = [];
    composer.use(commands);
    const messages = commands.on(ChatBotFilter.MessageText);
    messages.command('помощь').use(async (ctx, next) => {
      expectTypeOf(ctx.text).toEqualTypeOf<string>();
      expectTypeOf(ctx.args).toEqualTypeOf<string>();
      expectTypeOf(ctx.label).toEqualTypeOf<string>();
      seen.push(`${ctx.label}: ${ctx.args}`);
      await next();
    });
    commands.on([ChatBotFilter.Message, ChatBotFilter.MessageText], (ctx) => {
      seen.push(ctx.message.messageId);
    });
    composer.use(() => seen.push('после модуля'));
    const run = composer.middleware();
    try {
      await run(
        new AppContext(
          itd,
          { type: ChatUpdateType.NewMessage },
          { ...baseMessage, text: '/ПОМОЩЬ тест' },
        ),
        async () => {},
      );
      await run(new AppContext(itd, { type: ChatUpdateType.Typing }), async () => {});
      expect(seen).toEqual(['app: тест', 'm1', 'после модуля']);
    } finally {
      await itd.close();
    }
  });

  it('передаёт результат RegExp во вложенное hears() и сохраняет аргументы команды', async () => {
    const { itd } = setup();
    const composer = new ChatComposer();
    const seen: string[] = [];
    composer.command('echo').hears(/^\/echo (.+)$/u, (ctx) => {
      expectTypeOf<RegExpMatchArray>().toExtend<typeof ctx.match>();
      expectTypeOf(ctx.args).toEqualTypeOf<string>();
      expect(Array.isArray(ctx.match)).toBe(true);
      seen.push(ctx.args, ctx.match[1] ?? '');
    });
    try {
      await composer.middleware()(
        new ChatContext(
          itd,
          { type: ChatUpdateType.NewMessage },
          { ...baseMessage, text: '/echo привет' },
        ),
        async () => {},
      );
      expect(seen).toEqual(['привет', 'привет']);
    } finally {
      await itd.close();
    }
  });

  it('выбирает именованную ветку, её запасной маршрут и условную ветку', async () => {
    const { itd } = setup();
    const composer = new ChatComposer();
    const router = composer.router(async (ctx) => ctx.chatId);
    const seen: string[] = [];
    router.route('support').command('help', async (_ctx, next) => {
      seen.push('поддержка');
      await next();
    });
    router.route('team').use(async (_ctx, next) => {
      seen.push('команда');
      await next();
    });
    router.otherwise().use(async (_ctx, next) => {
      seen.push('другой чат');
      await next();
    });
    composer.branch(
      async (ctx) => ctx.chatId === 'team',
      (_ctx, next) => {
        seen.push('внутренний чат');
        return next();
      },
      (_ctx, next) => {
        seen.push('внешний чат');
        return next();
      },
    );
    composer.branch(
      (ctx) => ctx.chatId === 'support',
      (_ctx, next) => {
        seen.push('ответ поддержки');
        return next();
      },
    );
    const run = composer.middleware();
    try {
      for (const chatId of ['support', 'team', 'unknown']) {
        await run(
          new ChatContext(
            itd,
            { type: ChatUpdateType.NewMessage, chatId },
            { ...baseMessage, text: '/help' },
          ),
          async () => {
            seen.push('дальше');
          },
        );
      }
      expect(seen).toEqual([
        'поддержка',
        'внешний чат',
        'ответ поддержки',
        'дальше',
        'команда',
        'внутренний чат',
        'дальше',
        'другой чат',
        'внешний чат',
        'дальше',
      ]);
    } finally {
      await itd.close();
    }
  });

  it('использует префиксы бота в общем модуле и его маршрутах', async () => {
    const { itd } = setup();
    const module = new ChatComposer();
    const seen: string[] = [];
    module
      .router((ctx) => ctx.chatId)
      .route('c1')
      .command('help', ({ text }) => seen.push(text));
    const first = new ChatBot(itd, { commandPrefixes: ['!'] }).use(module).middleware();
    const second = new ChatBot(itd, { commandPrefixes: ['.'] }).use(module).middleware();
    const context = (text: string) =>
      new ChatContext(
        itd,
        { type: ChatUpdateType.NewMessage, chatId: 'c1' },
        { ...baseMessage, text },
      );
    const next = async () => {};
    try {
      await first(context('!help'), next);
      await second(context('.help'), next);
      await first(context('.help'), next);
      await second(context('!help'), next);
      expect(seen).toEqual(['!help', '.help']);
    } finally {
      await itd.close();
    }
  });
});
