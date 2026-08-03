import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Thin wrapper over node:sqlite. Everything that touches the database goes
 * through here, so swapping in better-sqlite3 later means rewriting this file
 * and nothing else.
 */

export type Params = Record<string, unknown> | undefined;

/** SQLite has no boolean and no Date. Normalise before every bind. */
function normalise(params: Params): Record<string, SQLInputValue> {
  const out: Record<string, SQLInputValue> = {};
  if (!params) return out;
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) out[key] = null;
    else if (typeof value === 'boolean') out[key] = value ? 1 : 0;
    else if (value instanceof Date) out[key] = value.toISOString();
    else if (typeof value === 'number' || typeof value === 'string' || typeof value === 'bigint') out[key] = value;
    else if (value instanceof Uint8Array) out[key] = value;
    else out[key] = JSON.stringify(value);
  }
  return out;
}

export class Db {
  readonly raw: DatabaseSync;
  private readonly cache = new Map<string, StatementSync>();
  private depth = 0;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.raw = new DatabaseSync(path);
    this.raw.exec('PRAGMA journal_mode = WAL');
    this.raw.exec('PRAGMA foreign_keys = ON');
    this.raw.exec('PRAGMA busy_timeout = 5000');
  }

  private stmt(sql: string): StatementSync {
    let s = this.cache.get(sql);
    if (!s) {
      s = this.raw.prepare(sql);
      this.cache.set(sql, s);
    }
    return s;
  }

  exec(sql: string): void {
    this.raw.exec(sql);
  }

  run(sql: string, params?: Params): { changes: number } {
    const r = this.stmt(sql).run(normalise(params));
    return { changes: Number(r.changes) };
  }

  get<T>(sql: string, params?: Params): T | undefined {
    return this.stmt(sql).get(normalise(params)) as T | undefined;
  }

  all<T>(sql: string, params?: Params): T[] {
    return this.stmt(sql).all(normalise(params)) as T[];
  }

  /** Nested calls use savepoints so a helper can open a transaction safely. */
  tx<T>(fn: () => T): T {
    const name = `sp_${this.depth}`;
    this.exec(this.depth === 0 ? 'BEGIN' : `SAVEPOINT ${name}`);
    this.depth++;
    try {
      const result = fn();
      this.depth--;
      this.exec(this.depth === 0 ? 'COMMIT' : `RELEASE ${name}`);
      return result;
    } catch (err) {
      this.depth--;
      this.exec(this.depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${name}`);
      throw err;
    }
  }

  close(): void {
    this.cache.clear();
    this.raw.close();
  }
}

export function json<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
