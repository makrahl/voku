import { Router } from 'express';
import { z } from 'zod';
import { param, parseBody, route } from '../http.js';
import { requireAdmin, requireTeacher } from '../middleware/auth.js';
import { getLlmConfig, getLlmPublic, isLlmConfigured, setLlmConfig } from '../services/settings.js';
import { testConnection } from '../services/llm/client.js';
import { listModels } from '../services/llm/models.js';
import { jobView } from '../services/jobs.js';

const LlmPatchSchema = z.object({
  baseUrl: z.string().url().optional(),
  /** Empty string clears the stored key. */
  apiKey: z.string().optional(),
  model: z.string().optional(),
  visionModel: z.string().optional(),
});

export const settingsRouter: Router = Router();
settingsRouter.use(requireTeacher);

/**
 * The language model is instance-wide — one account, one key, one bill — so it
 * is configured by an admin, not brought along by each teacher.
 *
 * Reading is the exception: every teacher needs to know whether the AI buttons
 * should appear at all. They are told that and nothing else; the provider, the
 * model and the presence of a key stay with the admins.
 */
settingsRouter.get(
  '/llm',
  route((req, res) => {
    const configured = isLlmConfigured(req.db);
    if (req.teacher!.is_admin !== 1) {
      res.json({ configured });
      return;
    }
    res.json({ ...getLlmPublic(req.db), configured });
  }),
);

settingsRouter.put(
  '/llm',
  requireAdmin,
  route((req, res) => {
    setLlmConfig(req.db, parseBody(LlmPatchSchema, req.body));
    res.json({ ...getLlmPublic(req.db), configured: isLlmConfigured(req.db) });
  }),
);

/**
 * The provider's catalogue, for the model chooser. Accepts a base URL and key
 * as query parameters so the list can be browsed while typing them in, before
 * anything has been saved.
 */
settingsRouter.get(
  '/llm/models',
  requireAdmin,
  route(async (req, res) => {
    const stored = getLlmConfig(req.db);
    const baseUrl = typeof req.query.baseUrl === 'string' && req.query.baseUrl ? req.query.baseUrl : stored.baseUrl;
    const apiKey = typeof req.query.apiKey === 'string' && req.query.apiKey ? req.query.apiKey : stored.apiKey;
    res.json({ models: await listModels({ ...stored, baseUrl, apiKey }) });
  }),
);

settingsRouter.post(
  '/llm/test',
  requireAdmin,
  route(async (req, res) => {
    res.json(await testConnection(getLlmConfig(req.db)));
  }),
);

export const jobsRouter: Router = Router();
jobsRouter.use(requireTeacher);

jobsRouter.get(
  '/:id',
  route((req, res) => {
    res.json(jobView(req.db, param(req, 'id')));
  }),
);
