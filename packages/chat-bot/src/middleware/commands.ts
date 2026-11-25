import { ItdConfigError } from 'itd-api';
import type { ChatContext } from '../context/context.js';
import { isIncomingMessage } from './filters.js';
import type { ChatMessageContext } from './filters.types.js';

/** Точное текстовое совпадение, регулярное выражение или список условий. */
export type HearsTrigger = string | RegExp | readonly (string | RegExp)[];

/** Контекст обработчика команды. */
export type ChatCommandContext<C extends ChatContext = ChatContext> = ChatMessageContext<C> & {
  /** Полный текст входящего сообщения. */
  text: string;
  /** Имя команды без префикса, в нижнем регистре. */
  command: string;
  /** Текст после команды или пустая строка. */
  args: string;
  /** Аргументы команды, совпадают с `args`. */
  match: string;
};

/** Контекст обработчика текста. */
export type ChatHearsContext<C extends ChatContext = ChatContext> = ChatMessageContext<C> & {
  /** Полный текст входящего сообщения. */
  text: string;
  /** Совпавшая строка или результат вызова `RegExp.exec()`. */
  match: string | RegExpMatchArray;
};

/** Приводит имя команды к единому регистру и форме Unicode. */
function normalizeCommand(name: string): string {
  return name.normalize('NFC').toLowerCase();
}

/** Распознаёт команду во входящем сообщении. @internal */
export function commandPredicate<C extends ChatContext>(
  commands: string | readonly string[],
  prefixes: readonly string[],
): (context: C) => context is ChatCommandContext<C> {
  const names = typeof commands === 'string' ? [commands] : commands;
  if (!names.length || names.some((name) => !/^[\p{L}\p{N}_][\p{L}\p{M}\p{N}_]*$/u.test(name))) {
    throw new ItdConfigError('Укажите имена команд из букв, цифр и подчёркиваний');
  }
  const known = new Set(names.map(normalizeCommand));
  return (context): context is ChatCommandContext<C> => {
    if (!isIncomingMessage(context)) return false;
    const { text } = context;
    if (typeof text !== 'string') return false;
    const prefix = prefixes.find((value) => text.startsWith(value));
    if (prefix === undefined) return false;
    const match = /^(\S+)(?:\s+([\s\S]*))?$/.exec(text.slice(prefix.length));
    if (!match?.[1]) return false;
    const name = normalizeCommand(match[1]);
    if (!known.has(name)) return false;
    context.command = name;
    context.args = match[2] ?? '';
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
