import { createParser } from 'eventsource-parser';
import MarkdownIt from 'markdown-it';

const repo = 'KiowDev/itd-api';
const sourceRoot = `https://github.com/${repo}/blob/main/`;
const citationPattern = /\uE200cite repo="([^"\n]+)" path="([^"\n]+)" start="([1-9]\d*)" end="([1-9]\d*)"\s*\/>/g;
const searchLinkPattern = /^View this search on DeepWiki: (https:\/\/deepwiki\.com\/search\/[\w-]+)$/;
const markdown = new MarkdownIt({ html: false, linkify: true }).disable('image');

/** Преобразует ссылки на строки и подписи DeepWiki перед разбором Markdown. */
markdown.core.ruler.before('inline', 'deepwiki_references', (state) => {
  let citationNumber = 0;
  for (const token of state.tokens) {
    if (token.type !== 'inline') continue;
    const searchLink = searchLinkPattern.exec(token.content)?.[1];
    if (searchLink) {
      token.content = `[Открыть ответ в DeepWiki](${searchLink})`;
    } else if (token.content === 'Wiki pages you might want to explore:') {
      token.content = 'Ещё по теме:';
    } else {
      token.content = token.content.replace(
        citationPattern,
        (raw, citedRepo: string, path: string, start: string, end: string) => {
          const segments = path.split('/');
          if (
            citedRepo.toLowerCase() !== repo.toLowerCase() ||
            segments.some((segment) => !segment || segment === '.' || segment === '..')
          ) {
            return raw;
          }
          const lines = start === end ? `L${start}` : `L${start}-L${end}`;
          const url = `${sourceRoot}${segments.map(encodeURIComponent).join('/')}#${lines}`;
          return `[${++citationNumber}](<${url}> "Источник на GitHub: ${lines}")`;
        },
      );
    }
  }
});

// Ссылки на вики в ответах DeepWiki приходят относительно сайта сервиса.
markdown.renderer.rules.link_open = (tokens, index, options, _env, renderer) => {
  const token = tokens[index];
  if (!token) return '';
  const href = token.attrGet('href');
  if (href?.startsWith('/') && !href.startsWith('//')) {
    token.attrSet('href', `https://deepwiki.com${href.replace(/^\/wiki\//, '/')}`);
  }
  if (href?.startsWith(sourceRoot) && /#L\d+(?:-L\d+)?$/.test(href)) {
    token.attrSet('class', 'citation');
  }
  token.attrSet('target', '_blank');
  token.attrSet('rel', 'noopener noreferrer');
  return renderer.renderToken(tokens, index, options);
};

interface QuestionReply {
  id?: number;
  result?: {
    isError?: boolean;
    structuredContent?: { result?: string };
    content?: { type: string; text?: string }[];
  };
}

/** Извлекает ответ JSON-RPC из JSON или потока событий MCP. */
function readReply(body: string, contentType: string): QuestionReply | undefined {
  if (!contentType.includes('text/event-stream')) return JSON.parse(body) as QuestionReply;

  let reply: QuestionReply | undefined;
  createParser({
    onEvent(event) {
      const message = JSON.parse(event.data) as QuestionReply;
      if (message.id === 1) reply = message;
    },
  }).feed(body);
  return reply;
}

/** Запрашивает ответ по репозиторию и форматирует его Markdown. */
export async function askDeepWiki(question: string, signal: AbortSignal): Promise<string> {
  const response = await fetch('https://mcp.deepwiki.com/mcp', {
    method: 'POST',
    credentials: 'omit',
    headers: {
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
      'MCP-Protocol-Version': '2025-03-26',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'ask_wiki_question',
        arguments: { repoName: repo, question },
      },
    }),
    signal,
  });

  if (response.status === 429) {
    throw new Error('Слишком много запросов к DeepWiki. Попробуйте чуть позже.');
  }
  if (!response.ok) throw new Error('DeepWiki временно недоступен.');

  const reply = readReply(await response.text(), response.headers.get('Content-Type') ?? '');
  const result = reply?.result;
  const answer =
    result?.structuredContent?.result ?? result?.content?.find((part) => part.type === 'text')?.text;
  if (result?.isError || !answer?.trim()) throw new Error('DeepWiki не вернул ответ.');

  return markdown.render(answer);
}
