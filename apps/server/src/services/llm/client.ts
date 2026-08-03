import { ZodError, type ZodType } from 'zod';
import { HttpError } from '../../http.js';

/**
 * One client for every provider. OpenRouter, a local llama.cpp server and
 * OpenAI itself all speak the same chat-completions dialect, so the only thing
 * that changes between them is a base URL and a model name.
 */

export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  visionModel: string | null;
}

export class LlmError extends HttpError {
  constructor(message: string, details?: unknown) {
    super(502, message, details);
    this.name = 'LlmError';
  }
}

export interface ImagePart {
  /** A data: URI. Images never leave the request as a URL the provider must fetch. */
  dataUri: string;
}

export interface ChatRequest<T> {
  system: string;
  user: string;
  schema: ZodType<T>;
  images?: ImagePart[];
  model?: string;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

interface ChatChoice {
  message?: { content?: string | null };
}

async function callOnce(
  config: LlmConfig,
  body: unknown,
  signal?: AbortSignal,
): Promise<string> {
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.apiKey}`,
        // OpenRouter asks for these; harmless everywhere else.
        'http-referer': 'https://github.com/voku',
        'x-title': 'voku',
      },
      body: JSON.stringify(body),
      signal: signal ?? null,
    });
  } catch (err) {
    throw new LlmError(`Could not reach the language model at ${config.baseUrl}`, String(err));
  }

  const text = await response.text();
  if (!response.ok) {
    throw new LlmError(
      `The language model returned ${response.status}. Check the model name and API key in Settings.`,
      text.slice(0, 600),
    );
  }

  let parsed: { choices?: ChatChoice[] };
  try {
    parsed = JSON.parse(text) as { choices?: ChatChoice[] };
  } catch {
    throw new LlmError('The language model sent something that was not JSON.', text.slice(0, 600));
  }

  const content = parsed.choices?.[0]?.message?.content;
  if (!content) throw new LlmError('The language model returned an empty response.', text.slice(0, 600));
  return content;
}

/** Models like to wrap JSON in ```json fences however firmly you ask them not to. */
export function extractJson(raw: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw);
  const candidate = (fenced?.[1] ?? raw).trim();

  const firstBrace = candidate.search(/[{[]/);
  if (firstBrace === -1) return candidate;
  const lastBrace = Math.max(candidate.lastIndexOf('}'), candidate.lastIndexOf(']'));
  return lastBrace > firstBrace ? candidate.slice(firstBrace, lastBrace + 1) : candidate;
}

/**
 * Asks for JSON, validates it against the schema, and on failure retries once
 * with the validation error fed back in. Models are usually right the second
 * time when told exactly which field was wrong.
 */
export async function chatJson<T>(config: LlmConfig, request: ChatRequest<T>): Promise<T> {
  const model = request.model ?? config.model;
  if (!model) throw new LlmError('No model is configured. Set one in Settings.');
  if (!config.apiKey) throw new LlmError('No API key is configured. Add one in Settings.');

  const content: unknown[] = [{ type: 'text', text: request.user }];
  for (const image of request.images ?? []) {
    content.push({ type: 'image_url', image_url: { url: image.dataUri } });
  }

  const messages: unknown[] = [
    { role: 'system', content: request.system },
    { role: 'user', content: request.images?.length ? content : request.user },
  ];

  let lastError = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const body = {
      model,
      messages:
        attempt === 0
          ? messages
          : [
              ...messages,
              {
                role: 'user',
                content: `Your last reply could not be used: ${lastError}\nReply again with valid JSON only, matching the format exactly.`,
              },
            ],
      response_format: { type: 'json_object' },
      temperature: request.temperature ?? 0.3,
      max_tokens: request.maxTokens ?? 4000,
    };

    const raw = await callOnce(config, body, request.signal);
    try {
      return request.schema.parse(JSON.parse(extractJson(raw)));
    } catch (err) {
      lastError =
        err instanceof ZodError
          ? err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
          : `not valid JSON (${(err as Error).message})`;
    }
  }

  throw new LlmError('The language model could not produce the expected format.', lastError);
}

/** Cheap round-trip used by the "Test connection" button on the settings page. */
export async function testConnection(config: LlmConfig): Promise<{ ok: true; model: string }> {
  const { z } = await import('zod');
  await chatJson(config, {
    system: 'You reply with JSON only.',
    user: 'Reply with exactly {"ok": true}.',
    schema: z.object({ ok: z.boolean() }),
    maxTokens: 50,
  });
  return { ok: true, model: config.model };
}
