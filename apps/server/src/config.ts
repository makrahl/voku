import { resolve } from 'node:path';

function env(key: string, fallback: string): string {
  const v = process.env[key];
  return v === undefined || v === '' ? fallback : v;
}

const root = resolve(import.meta.dirname, '..');

export const config = {
  port: Number(env('PORT', '3000')),
  databasePath: resolve(root, env('DATABASE_PATH', 'data/voku.db')),
  /** Public origin, used to build the QR login links. No trailing slash. */
  publicBaseUrl: env('PUBLIC_BASE_URL', `http://localhost:${env('PORT', '3000')}`).replace(/\/+$/, ''),
  isProduction: process.env.NODE_ENV === 'production',
  /** Static build of the web app, served as the SPA in production. */
  publicDir: resolve(root, 'public'),
  sessionDays: 30,
  /** Seeds the settings row on first run; the admin UI takes over after that. */
  llmDefaults: {
    baseUrl: env('LLM_BASE_URL', 'https://openrouter.ai/api/v1'),
    apiKey: env('LLM_API_KEY', ''),
    model: env('LLM_MODEL', ''),
    visionModel: env('LLM_VISION_MODEL', ''),
  },
} as const;

/** Cookies must not be Secure over plain http, or local development silently breaks. */
export const cookieSecure = config.publicBaseUrl.startsWith('https://');
