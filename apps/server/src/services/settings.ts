import type { LlmSettingsPublic } from '@voku/shared';
import type { Db } from '../db/index.js';
import { json } from '../db/index.js';
import { config } from '../config.js';
import type { LlmConfig } from './llm/client.js';

const LLM_KEY = 'llm';

interface StoredLlm {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  visionModel?: string;
}

function stored(db: Db): StoredLlm {
  const row = db.get<{ value_json: string }>('SELECT value_json FROM settings WHERE key = :k', {
    k: LLM_KEY,
  });
  return json<StoredLlm>(row?.value_json, {});
}

/** Environment variables seed the defaults; the settings page overrides them. */
export function getLlmConfig(db: Db): LlmConfig {
  const saved = stored(db);
  return {
    baseUrl: saved.baseUrl || config.llmDefaults.baseUrl,
    apiKey: saved.apiKey || config.llmDefaults.apiKey,
    model: saved.model || config.llmDefaults.model,
    visionModel: saved.visionModel || config.llmDefaults.visionModel || null,
  };
}

/** The API key is write-only — the client is told whether one exists, never what it is. */
export function getLlmPublic(db: Db): LlmSettingsPublic {
  const cfg = getLlmConfig(db);
  return {
    baseUrl: cfg.baseUrl,
    model: cfg.model,
    visionModel: cfg.visionModel,
    hasApiKey: Boolean(cfg.apiKey),
  };
}

export function setLlmConfig(db: Db, patch: StoredLlm): void {
  const next = { ...stored(db), ...patch };
  // An empty string means "clear this", which is how you remove a saved key.
  for (const key of Object.keys(next) as Array<keyof StoredLlm>) {
    if (next[key] === '' || next[key] === undefined) delete next[key];
  }
  db.run(
    `INSERT INTO settings (key, value_json) VALUES (:k, :v)
     ON CONFLICT(key) DO UPDATE SET value_json = :v`,
    { k: LLM_KEY, v: JSON.stringify(next) },
  );
}

/** With no key configured the AI buttons hide and every manual path stays open. */
export function isLlmConfigured(db: Db): boolean {
  const cfg = getLlmConfig(db);
  return Boolean(cfg.apiKey && cfg.model);
}
