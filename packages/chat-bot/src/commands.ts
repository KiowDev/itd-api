import { ItdConfigError } from 'itd-api';
import type { ChatContext } from './context.js';
import { type ChatMessageContext, isIncomingMessage } from './filters.js';

/** Точное текстовое совпадение, регулярное выражение или список условий. */
export type HearsTrigger = string | RegExp | readonly (string | RegExp)[];

/** Контекст обработчика команды. */
export type ChatCommandContext<C extends ChatContext = ChatContext> = ChatMessageContext<C> & {
  text: string;
  command: string;
  args: string;
  match: string;
};

/** Контекст обработчика текста. */
export type ChatHearsContext<C extends ChatContext = ChatContext> = ChatMessageContext<C> & {
  text: string;
  match: string | RegExpMatchArray;
};

/** Распознаёт команду во входящем сообщении. @internal */
export function commandPredicate<C extends ChatContext>(
  commands: string | readonly string[],
): (context: C) => context is ChatCommandContext<C> {
  const names = typeof commands === 'string' ? [commands] : commands;
  if (!names.length || names.some((name) => !/^[A-Za-z0-9_]+$/.test(name))) {
    throw new ItdConfigError('Укажите имена команд из латинских букв, цифр и подчёркиваний');
  }
  const known = new Set(names);
  return (context): context is ChatCommandContext<C> => {
    if (!isIncomingMessage(context) || typeof context.text !== 'string') return false;
    const match = /^\/([A-Za-z0-9_]+)(?:\s+([\s\S]*))?$/.exec(context.text);
    const name = match?.[1];
    if (name === undefined || !known.has(name)) return false;
    context.command = name;
    context.args = match?.[2]?.trimStart() ?? '';
    context.match = context.args;
    return true;
  };
}

/** Сопоставляет текст входящего сообщения с заданными условиями. @internal */
export function hearsPredicate<C extends ChatContext>(
  trigger: HearsTrigger,
): (context: C) => context is ChatHearsContext<C> {
  const triggers = typeof trigger === 'string' || trigger instanceof RegExp ? [trigger] : trigger;
  if (!triggers.length) throw new ItdConfigError('Укажите хотя бы одно условие для hears()');
  const patterns = triggers.map((item) => (typeof item === 'string' ? item : new RegExp(item)));
  return (context): context is ChatHearsContext<C> => {
    if (!isIncomingMessage(context) || typeof context.text !== 'string') return false;
    for (const pattern of patterns) {
      if (typeof pattern === 'string') {
        if (context.text !== pattern) continue;
        context.match = pattern;
        return true;
      }
      pattern.lastIndex = 0;
      const match = pattern.exec(context.text);
      if (match) {
        context.match = match;
        return true;
      }
    }
    return false;
  };
}
