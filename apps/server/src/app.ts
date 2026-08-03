import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from './db/index.js';
import { config } from './config.js';
import { errorHandler, notFound } from './http.js';
import { authRouter } from './routes/auth.js';
import { classesRouter, studentsRouter } from './routes/classes.js';
import { testsRouter } from './routes/tests.js';
import { studentRouter } from './routes/student.js';
import { jobsRouter, settingsRouter } from './routes/settings.js';
import { inviteRouter, setupRouter, teamRouter } from './routes/team.js';

export function createApp(db: Db): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '8mb' }));
  app.use(cookieParser());
  app.use((req, _res, next) => {
    req.db = db;
    next();
  });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.use('/api/setup', setupRouter);
  app.use('/api/invites', inviteRouter);
  app.use('/api/admin/auth', authRouter);
  app.use('/api/admin/team', teamRouter);
  app.use('/api/admin/classes', classesRouter);
  app.use('/api/admin/students', studentsRouter);
  app.use('/api/admin/tests', testsRouter);
  app.use('/api/admin/settings', settingsRouter);
  app.use('/api/admin/jobs', jobsRouter);
  app.use('/api/s', studentRouter);

  app.use('/api', (_req, _res, next) => next(notFound('No such endpoint')));

  // In production the built web app lives here and every non-API path is the SPA.
  if (existsSync(config.publicDir)) {
    app.use(express.static(config.publicDir, { index: false }));
    app.get(/.*/, (_req, res) => {
      res.sendFile(join(config.publicDir, 'index.html'));
    });
  }

  app.use(errorHandler);
  return app;
}
