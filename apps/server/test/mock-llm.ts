import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';

/**
 * A stand-in for an OpenAI-compatible provider. It reads the prompt to work out
 * which pass is being run and replies with a well-formed answer, so the whole
 * composer can be exercised without a network call or an API key.
 */
export interface MockLlm {
  baseUrl: string;
  /** Every request body the server received, for asserting on prompt content. */
  requests: Array<{ model: string; system: string; user: string; hasImages: boolean }>;
  /** Queue a canned reply to be used for the next request instead of the default. */
  enqueue(content: string): void;
  /** Make the next request fail with this status. */
  failNext(status: number, body?: string): void;
  stop(): Promise<void>;
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === 'object' && part && 'text' in part ? String(part.text) : ''))
      .join('\n');
  }
  return '';
}

function hasImages(content: unknown): boolean {
  return (
    Array.isArray(content) &&
    content.some((part) => typeof part === 'object' && part && 'image_url' in part)
  );
}

/** Pulls the numbered word list back out of the prompt so replies line up. */
function headwordsIn(user: string): string[] {
  const out: string[] = [];
  for (const line of user.split('\n')) {
    const match = /^\d+\.\s+"([^"]+)"/.exec(line.trim());
    if (match) out.push(match[1]!);
  }
  return out;
}

function defaultReply(system: string, user: string): string {
  if (system.includes('read text out of images')) {
    return JSON.stringify({ text: 'She was reluctant to answer, but nevertheless she did.' });
  }

  if (system.includes('extract vocabulary')) {
    return JSON.stringify({
      words: [
        {
          headword: 'reluctant',
          lemma: 'reluctant',
          pos: 'adjective',
          translationDe: 'widerwillig',
          alternativesDe: ['zögerlich'],
          alternativesEn: ['unwilling'],
          difficulty: 6,
          trickiness: 0,
          trickinessKind: 'none',
          contextSentence: 'She was reluctant to answer.',
          suitsFillBlank: true,
          suitsDefinitionMcq: true,
        },
        {
          headword: 'become',
          lemma: 'become',
          pos: 'verb',
          translationDe: 'werden',
          alternativesDe: [],
          alternativesEn: [],
          difficulty: 2,
          trickiness: 3,
          trickinessKind: 'false_friend',
          trickinessNote: "German 'bekommen' means to receive, not to become",
          contextSentence: 'He wanted to become a teacher.',
          suitsFillBlank: true,
          suitsDefinitionMcq: false,
        },
        {
          headword: 'nevertheless',
          lemma: 'nevertheless',
          pos: 'adverb',
          translationDe: 'dennoch',
          alternativesDe: ['trotzdem'],
          alternativesEn: [],
          difficulty: 8,
          trickiness: 0,
          trickinessKind: 'none',
          contextSentence: 'Nevertheless, she answered.',
          suitsFillBlank: false,
          suitsDefinitionMcq: false,
        },
      ],
    });
  }

  if (system.includes('wrong answers')) {
    return JSON.stringify({
      items: headwordsIn(user).map((headword) => ({
        headword,
        distractors: [`${headword}-wrong-1`, `${headword}-wrong-2`, `${headword}-wrong-3`],
      })),
    });
  }

  // Before the definition branch: that one matches on "definitions", which the
  // glossary prompt also talks about.
  if (system.includes('glossary entries')) {
    return JSON.stringify({
      items: headwordsIn(user).map((headword) => ({
        headword,
        definition: 'a short plain explanation of the idea in question',
        example: `Everyone noticed how ${headword} the whole afternoon turned out to be.`,
      })),
    });
  }

  if (system.includes('definitions')) {
    return JSON.stringify({
      items: headwordsIn(user).map((headword) => ({
        headword,
        // Deliberately avoids containing the headword, which the composer checks.
        definition: 'a short plain explanation of the idea in question',
        distractors: [`${headword}-alt-1`, `${headword}-alt-2`, `${headword}-alt-3`],
      })),
    });
  }

  if (system.includes('gap-fill')) {
    return JSON.stringify({
      items: headwordsIn(user).map((headword) => ({
        headword,
        sentence: `The class was completely ___ about the news.`,
        accepted: [headword],
      })),
    });
  }

  return JSON.stringify({ ok: true });
}

export async function startMockLlm(): Promise<MockLlm> {
  const requests: MockLlm['requests'] = [];
  const queued: string[] = [];
  let failure: { status: number; body: string } | null = null;

  const server: Server = createServer((req, res) => {
    // The catalogue endpoint of the OpenAI-compatible dialect.
    if (req.method === 'GET' && req.url?.endsWith('/models')) {
      if (failure) {
        const { status, body } = failure;
        failure = null;
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(body);
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          data: [
            {
              id: 'anthropic/claude-sonnet-4.5',
              name: 'Anthropic: Claude Sonnet 4.5',
              context_length: 200000,
              architecture: { input_modalities: ['text', 'image'] },
              pricing: { prompt: '0.000003' },
            },
            {
              id: 'meta/llama-3-70b',
              name: 'Meta: Llama 3 70B',
              context_length: 8192,
              architecture: { input_modalities: ['text'] },
              pricing: { prompt: '0' },
            },
            // Older providers describe modality as a single string.
            { id: 'legacy/vision-1', architecture: { modality: 'text+image->text' } },
            // A bare entry, which is all some local servers return.
            { id: 'local/bare-model' },
            // Junk that must not crash the parser.
            { name: 'no id at all' },
          ],
        }),
      );
      return;
    }

    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      if (failure) {
        const { status, body } = failure;
        failure = null;
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(body);
        return;
      }

      const body = JSON.parse(raw || '{}') as {
        model?: string;
        messages?: Array<{ role: string; content: unknown }>;
      };
      const system = textOf(body.messages?.find((m) => m.role === 'system')?.content);
      const userMessages = body.messages?.filter((m) => m.role === 'user') ?? [];
      const userMessage = userMessages[0];
      // Joined, not just the first: a retry appends a correction message and
      // assertions need to see both the original prompt and the feedback.
      const user = userMessages.map((m) => textOf(m.content)).join('\n');

      requests.push({
        model: body.model ?? '',
        system,
        user,
        hasImages: hasImages(userMessage?.content),
      });

      const content = queued.shift() ?? defaultReply(system, user);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content } }] }));
    });
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    requests,
    enqueue: (content) => queued.push(content),
    failNext: (status, body = '{"error":"nope"}') => (failure = { status, body }),
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
