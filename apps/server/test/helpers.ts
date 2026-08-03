import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { Db } from '../src/db/index.js';
import { migrate } from '../src/db/migrations.js';
import { createApp } from '../src/app.js';
import { createTeacher } from '../src/services/auth.js';

export interface ApiResponse<T = any> {
  status: number;
  body: T;
  headers: Headers;
}

/**
 * Spins up the real Express app on an ephemeral port with an in-memory database
 * and drives it over actual HTTP, so cookies, middleware order and JSON parsing
 * are all exercised rather than stubbed.
 */
export class TestServer {
  private readonly cookies = new Map<string, string>();

  private constructor(
    readonly db: Db,
    private readonly server: Server,
    readonly base: string,
  ) {}

  static async start(): Promise<TestServer> {
    const db = new Db(':memory:');
    migrate(db);
    const server = createApp(db).listen(0, '127.0.0.1');
    await once(server, 'listening');
    const { port } = server.address() as AddressInfo;
    return new TestServer(db, server, `http://127.0.0.1:${port}`);
  }

  private captureCookies(res: Response): void {
    for (const raw of res.headers.getSetCookie()) {
      const pair = raw.split(';')[0] ?? '';
      const eq = pair.indexOf('=');
      if (eq <= 0) continue;
      const name = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      if (value === '') this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  cookie(name: string): string | undefined {
    return this.cookies.get(name);
  }

  clearCookies(): void {
    this.cookies.clear();
  }

  async request<T = any>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (this.cookies.size > 0) {
      headers['cookie'] = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    }
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
    });
    this.captureCookies(res);
    const text = await res.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    return { status: res.status, body: parsed as T, headers: res.headers };
  }

  get<T = any>(path: string) {
    return this.request<T>('GET', path);
  }
  post<T = any>(path: string, body?: unknown) {
    return this.request<T>('POST', path, body);
  }
  patch<T = any>(path: string, body?: unknown) {
    return this.request<T>('PATCH', path, body);
  }
  delete<T = any>(path: string) {
    return this.request<T>('DELETE', path);
  }

  /** Creates the single teacher account and signs in, leaving the cookie in the jar. */
  async signInAsTeacher(email = 'teacher@school.de', password = 'hunter2hunter2'): Promise<void> {
    createTeacher(this.db, email, password);
    const res = await this.post('/api/admin/auth/login', { email, password });
    if (res.status !== 200) throw new Error(`sign-in failed: ${JSON.stringify(res.body)}`);
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
    this.db.close();
  }
}
