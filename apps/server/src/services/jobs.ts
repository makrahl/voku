import { randomUUID } from 'node:crypto';
import type { JobKind, JobView } from '@voku/shared';
import type { Db } from '../db/index.js';
import { json } from '../db/index.js';
import { notFound } from '../http.js';

/**
 * Extraction and generation take long enough that a request would time out, so
 * they run as jobs: POST enqueues and returns an id, the admin UI polls for a
 * progress bar. In-process and single-instance by design — the whole app is one
 * teacher on one small server, and a queue would be machinery without a purpose.
 */

export interface JobRow {
  id: string;
  kind: JobKind;
  test_id: string | null;
  status: 'queued' | 'running' | 'done' | 'error';
  progress: number;
  total: number;
  result_json: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export function createJob(db: Db, kind: JobKind, testId: string | null, total = 0): string {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO jobs (id, kind, test_id, status, progress, total, created_at, updated_at)
     VALUES (:id, :kind, :test_id, 'queued', 0, :total, :now, :now)`,
    { id, kind, test_id: testId, total, now },
  );
  return id;
}

export function jobView(db: Db, jobId: string): JobView {
  const row = db.get<JobRow>('SELECT * FROM jobs WHERE id = :id', { id: jobId });
  if (!row) throw notFound('No such job');
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    progress: row.progress,
    total: row.total,
    error: row.error,
    result: row.result_json ? json<unknown>(row.result_json, null) : null,
  };
}

export interface JobReporter {
  setTotal(total: number): void;
  advance(by?: number): void;
}

/**
 * Kicks the work off without awaiting it. Failures are recorded on the job row
 * rather than thrown, so a bad model response shows up in the UI as a message
 * instead of an unhandled rejection.
 */
export function startJob(db: Db, jobId: string, work: (report: JobReporter) => Promise<unknown>): void {
  const touch = (fields: string, params: Record<string, unknown>) =>
    db.run(`UPDATE jobs SET ${fields}, updated_at = :now WHERE id = :id`, {
      ...params,
      now: new Date().toISOString(),
      id: jobId,
    });

  const reporter: JobReporter = {
    setTotal: (total) => touch('total = :total', { total }),
    advance: (by = 1) => touch('progress = progress + :by', { by }),
  };

  touch(`status = 'running'`, {});

  void (async () => {
    try {
      const result = await work(reporter);
      touch(`status = 'done', result_json = :result`, { result: JSON.stringify(result ?? null) });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[voku] job ${jobId} failed:`, err);
      touch(`status = 'error', error = :error`, { error: message });
    }
  })();
}

/** A job left running when the process restarted can never finish. */
export function failStaleJobs(db: Db): number {
  return db.run(
    `UPDATE jobs SET status = 'error', error = 'Interrupted by a server restart'
      WHERE status IN ('queued', 'running')`,
  ).changes;
}
