import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestServer } from './helpers.js';
import { TEACHER_COOKIE } from '../src/middleware/auth.js';
import { createTeacher, purgeExpiredSessions } from '../src/services/auth.js';

let server: TestServer;

beforeEach(async () => {
  server = await TestServer.start();
});
afterEach(async () => {
  await server.stop();
});

describe('teacher authentication', () => {
  it('rejects a wrong password without revealing whether the account exists', async () => {
    createTeacher(server.db, 'teacher@school.de', 'hunter2hunter2');

    const wrongPassword = await server.post('/api/admin/auth/login', {
      email: 'teacher@school.de',
      password: 'nope',
    });
    const wrongEmail = await server.post('/api/admin/auth/login', {
      email: 'nobody@school.de',
      password: 'hunter2hunter2',
    });

    expect(wrongPassword.status).toBe(401);
    expect(wrongEmail.status).toBe(401);
    expect(wrongPassword.body.error).toBe(wrongEmail.body.error);
  });

  it('signs in, sets an httpOnly cookie, and identifies the teacher', async () => {
    createTeacher(server.db, 'Teacher@School.de', 'hunter2hunter2');

    // Email match is case-insensitive — nobody remembers how they typed it.
    const login = await server.post('/api/admin/auth/login', {
      email: 'teacher@SCHOOL.de',
      password: 'hunter2hunter2',
    });
    expect(login.status).toBe(200);
    expect(login.body.email).toBe('teacher@school.de');

    const setCookie = login.headers.getSetCookie().join(';');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    expect(server.cookie(TEACHER_COOKIE)).toBeTruthy();

    const me = await server.get('/api/admin/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.email).toBe('teacher@school.de');
  });

  it('refuses protected routes without a session', async () => {
    const me = await server.get('/api/admin/auth/me');
    expect(me.status).toBe(401);
  });

  it('rejects a forged session token', async () => {
    await server.signInAsTeacher();
    server.clearCookies();
    const res = await server.request('GET', '/api/admin/auth/me');
    expect(res.status).toBe(401);
  });

  it('logging out invalidates the session server-side, not just the cookie', async () => {
    await server.signInAsTeacher();
    const token = server.cookie(TEACHER_COOKIE)!;

    expect((await server.post('/api/admin/auth/logout')).status).toBe(204);
    expect(server.db.get('SELECT id FROM sessions WHERE id = :id', { id: token })).toBeUndefined();
    expect((await server.get('/api/admin/auth/me')).status).toBe(401);
  });

  it('does not accept an expired session', async () => {
    await server.signInAsTeacher();
    const token = server.cookie(TEACHER_COOKIE)!;

    server.db.run('UPDATE sessions SET expires_at = :past WHERE id = :id', {
      past: new Date(Date.now() - 1000),
      id: token,
    });

    expect((await server.get('/api/admin/auth/me')).status).toBe(401);
    expect(purgeExpiredSessions(server.db)).toBe(1);
  });

  it('validates the request body', async () => {
    const res = await server.post('/api/admin/auth/login', { email: '' });
    expect(res.status).toBe(400);
    expect(Array.isArray(res.body.details)).toBe(true);
  });

  it('returns 404 JSON for unknown API paths rather than HTML', async () => {
    const res = await server.get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.error).toBeTruthy();
  });
});
