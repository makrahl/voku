import { Router } from 'express';
import { z } from 'zod';
import { param, parseBody, route } from '../http.js';
import { requireTeacher } from '../middleware/auth.js';
import { getLlmConfig, getLlmPublic, isLlmConfigured, setLlmConfig } from '../services/settings.js';
import { testConnection } from '../services/llm/client.js';
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

settingsRouter.get(
  '/llm',
  route((req, res) => {
    res.json({ ...getLlmPublic(req.db), configured: isLlmConfigured(req.db) });
  }),
);

settingsRouter.put(
  '/llm',
  route((req, res) => {
    setLlmConfig(req.db, parseBody(LlmPatchSchema, req.body));
    res.json({ ...getLlmPublic(req.db), configured: isLlmConfigured(req.db) });
  }),
);

settingsRouter.post(
  '/llm/test',
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
