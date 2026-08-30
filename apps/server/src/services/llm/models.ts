import { LlmError, type LlmConfig } from './client.js';

/**
 * The provider's catalogue. `GET /models` is part of the OpenAI-compatible
 * dialect; everything beyond `id` is optional. Proxied so the key stays on the
 * server, there is no CORS, and 400 kB becomes the fields a chooser needs.
 */

export interface ModelChoice {
  id: string;
  name: string;
  /** Tokens of context, when the provider says. */
  contextLength: number | null;
  /** Can read images — the vision model field needs one of these. */
  vision: boolean;
  /** US dollars per million prompt tokens, when the provider says. */
  promptPricePerMillion: number | null;
}

interface RawModel {
  id?: unknown;
  name?: unknown;
  context_length?: unknown;
  architecture?: { input_modalities?: unknown; modality?: unknown } | null;
  pricing?: { prompt?: unknown } | null;
}

function isVision(raw: RawModel): boolean {
  const arch = raw.architecture;
  if (!arch) return false;

  const modalities = arch.input_modalities;
  if (Array.isArray(modalities)) return modalities.includes('image');

  // Older shape: "text+image->text".
  return typeof arch.modality === 'string' && arch.modality.includes('image');
}

function toNumber(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN;
  return Number.isFinite(n) ? n : null;
}

export async function listModels(config: LlmConfig): Promise<ModelChoice[]> {
  if (!config.baseUrl) throw new LlmError('No provider URL is configured.');

  let response: Response;
  try {
    response = await fetch(`${config.baseUrl.replace(/\/+$/, '')}/models`, {
      headers: {
        // Sent when available, not required: many providers list publicly.
        ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
        accept: 'application/json',
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw new LlmError(`Could not reach ${config.baseUrl} to list its models.`, String(err));
  }

  if (!response.ok) {
    throw new LlmError(
      `The provider returned ${response.status} when asked for its models. Check the URL, and the key if this provider needs one to list them.`,
      (await response.text()).slice(0, 400),
    );
  }

  let payload: { data?: unknown; models?: unknown };
  try {
    payload = (await response.json()) as { data?: unknown; models?: unknown };
  } catch {
    throw new LlmError('That provider did not return a usable model list.');
  }

  // OpenAI and OpenRouter use `data`; a few local servers use `models`.
  const raw = Array.isArray(payload.data)
    ? payload.data
    : Array.isArray(payload.models)
      ? payload.models
      : [];

  const models: ModelChoice[] = [];
  for (const entry of raw as RawModel[]) {
    if (typeof entry?.id !== 'string' || !entry.id) continue;
    const price = toNumber(entry.pricing?.prompt);
    models.push({
      id: entry.id,
      name: typeof entry.name === 'string' && entry.name ? entry.name : entry.id,
      contextLength: toNumber(entry.context_length),
      vision: isVision(entry),
      promptPricePerMillion: price === null ? null : price * 1_000_000,
    });
  }

  models.sort((a, b) => a.id.localeCompare(b.id));
  return models;
}
